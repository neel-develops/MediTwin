"""MediTwin Assistant — ask questions about beds, equipment and the queue in plain language.

Two engines, same tools:

* **Groq** (when ``GROQ_API_KEY`` is set): ``openai/gpt-oss-120b`` answers using read-only tools over the
  live database. It can *propose* an allocation, which the UI shows as a card that staff confirm.
* **Built-in** (default, offline): a deterministic intent engine that answers the common
  questions from the same tool functions. The demo never depends on network access.

Neither engine writes data. Allocations still go through the normal confirmed, transactional path.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable

from sqlalchemy.orm import Session

from .. import config
from ..constants import BED_FEATURES, BED_TYPES, DEVICE_TYPES, PRIORITY_RANK
from .ai import briefing, build_plan, forecast
from .common import minutes_since
from .insights import alerts, summary
from .rules import Ctx, recommend_for

SYSTEM_PROMPT = """You are the MediTwin Assistant, built into a hospital bed and equipment allocation dashboard.
Staff ask you about bed availability, equipment, the waiting queue, forecasts and where to place patients.

How to work:
- Answer from the tools; never invent counts, bed codes or patient codes. Call a tool whenever the question depends on live data.
- Be brief and scannable: lead with the direct answer (numbers first), then at most a few short bullets. Use bed and patient codes exactly as the tools return them.
- When someone asks where to put a patient, call recommend_beds and then propose_allocation for your top pick so staff get a one-click confirmation card. Say that staff must confirm it.
- You optimise resource fit (bed type, features, devices, ward load). You do not assess, diagnose or triage patients; priority is set by staff. If asked for clinical advice, say that is outside what MediTwin does.
- All data in this app is fictional demo data."""


# ------------------------------------------------------------------ tools (read-only)
def _ward_lookup(ctx: Ctx, name: str | None):
    if not name:
        return None
    n = name.strip().lower()
    for w in ctx.wards:
        if w.name.lower() == n or w.bed_code_prefix.lower() == n:
            return w
    for w in ctx.wards:
        if n in w.name.lower():
            return w
    return None


def t_summary(s: Session, _args: dict) -> dict:
    sm = summary(s)
    return {"beds": sm["beds"], "queue": sm["queue"],
            "wards": [{"name": w["name"], "beds": w["bed_count"], "available": w["counts"]["AVAILABLE"], "occupied": w["counts"]["OCCUPIED"],
                       "cleaning": w["counts"]["CLEANING"], "reserved": w["counts"]["RESERVED"], "maintenance": w["counts"]["MAINTENANCE"],
                       "occupancy_pct": w["occupancy_pct"]} for w in sm["wards"]],
            "devices": sm["equipment"]["by_type"]}


def t_find_beds(s: Session, args: dict) -> dict:
    ctx = Ctx(s)
    ward = _ward_lookup(ctx, args.get("ward"))
    status = (args.get("status") or "AVAILABLE").upper()
    btype = args.get("bed_type")
    feature = args.get("feature")
    beds = [b for b in ctx.beds if b.ward_id in ctx.active_ward_ids and (ward is None or b.ward_id == ward.id)
            and (status == "ANY" or b.status == status) and (not btype or b.bed_type == btype)
            and (not feature or feature in (b.features or []))]
    return {"count": len(beds), "ward": ward.name if ward else "all wards", "status": status,
            "beds": [{"bed_code": b.bed_code, "ward": ctx.ward_by_id[b.ward_id].name, "type": b.bed_type, "status": b.status,
                      "features": b.features or []} for b in beds[:25]], "truncated": len(beds) > 25}


def t_waiting(s: Session, _args: dict) -> dict:
    ctx = Ctx(s)
    rows = sorted((p for p in ctx.patients if p.status == "WAITING"), key=lambda p: (PRIORITY_RANK[p.priority], p.created_at))
    return {"count": len(rows), "patients": [{
        "patient_code": p.patient_code, "name": p.display_name, "priority": p.priority, "needs_bed_type": p.required_bed_type,
        "needs_equipment": p.required_equipment_types or [], "needs_features": p.required_bed_features or [],
        "waiting_minutes": minutes_since(p.created_at), "suitable_beds_now": recommend_for(ctx, p, 0)["eligible_count"]} for p in rows]}


def t_recommend(s: Session, args: dict) -> dict:
    ctx = Ctx(s)
    code = str(args.get("patient_code", "")).strip().upper()
    p = next((x for x in ctx.patients if x.patient_code == code), None)
    if not p:
        return {"error": f"No patient with code {code}."}
    if p.status != "WAITING":
        a = ctx.active_by_patient.get(p.id)
        bed = ctx.bed_by_id.get(a.bed_id) if a and a.bed_id else None
        return {"patient_code": p.patient_code, "status": p.status, "bed_code": bed.bed_code if bed else None,
                "note": "Patient is not waiting for a bed."}
    r = recommend_for(ctx, p, 5)
    return {"patient_code": p.patient_code, "name": p.display_name, "priority": p.priority, "eligible_count": r["eligible_count"],
            "top": [{"bed_code": x["bed_code"], "bed_id": x["bed_id"], "ward": x["ward_name"], "score": x["score"],
                     "devices": [d["equipment_code"] for d in x["devices"]], "why": x["matches"][:4]} for x in r["recommendations"]],
            "rejected_summary": r["rejected_summary"][:4]}


def t_equipment(s: Session, args: dict) -> dict:
    ctx = Ctx(s)
    want = args.get("equipment_type")
    out = {}
    for t in DEVICE_TYPES:
        if want and t != want:
            continue
        items = [e for e in ctx.equipment if e.tracking_mode == "INDIVIDUAL" and e.equipment_type == t]
        out[t] = {"total": len(items), **{st: sum(1 for e in items if e.status == st) for st in ("AVAILABLE", "IN_USE", "RESERVED", "MAINTENANCE")},
                  "waiting_patients_needing": sum(1 for p in ctx.patients if p.status == "WAITING" and t in (p.required_equipment_types or []))}
    stock = [{"type": e.equipment_type, "available": e.quantity_available, "total": e.quantity_total} for e in ctx.equipment if e.tracking_mode == "QUANTITY"]
    return {"devices": out, "stock": stock}


def t_alerts(s: Session, _args: dict) -> dict:
    a = alerts(s)
    return {"count": len(a), "alerts": [{"severity": x["severity"], "title": x["title"], "detail": x["detail"]} for x in a[:12]]}


def t_forecast(s: Session, args: dict) -> dict:
    f = forecast(s, int(args.get("hours") or 24), float(args.get("demand_factor") or 1.0))
    return {"simulated": True, "wards": f["wards"], "assumptions": f["assumptions"],
            "total_now_pct": f["series"][0]["occupancy_pct"], "total_end_pct": f["series"][-1]["occupancy_pct"]}


def t_plan(s: Session, _args: dict) -> dict:
    p = build_plan(s)
    return {k: p[k] for k in ("waiting", "placed", "unplaced", "urgent_total", "urgent_placed", "avg_score", "baseline_placed")} | {
        "assignments": [{"patient_code": i["patient_code"], "priority": i["priority"], "bed_code": i["bed_code"], "ward": i["ward_name"],
                         "score": i["score"], "reasons": i["reasons"][:3]} for i in p["items"]],
        "unplaced_patients": [{"patient_code": u["patient_code"], "blockers": u["blockers"], "fixes": [x["label"] for x in u["unlock"]]}
                              for u in p["unplaced_patients"]]}


def t_propose(s: Session, args: dict) -> dict:
    """Validates a proposal and returns a confirmation card. Does not write anything."""
    ctx = Ctx(s)
    code = str(args.get("patient_code", "")).strip().upper()
    bcode = str(args.get("bed_code", "")).strip().upper()
    p = next((x for x in ctx.patients if x.patient_code == code), None)
    b = next((x for x in ctx.beds if x.bed_code == bcode), None)
    if not p or not b:
        return {"error": "Unknown patient or bed code."}
    from .rules import evaluate_bed

    ev = evaluate_bed(ctx, b, p)
    if p.status != "WAITING":
        return {"error": f"{p.patient_code} is not waiting for a bed."}
    if not ev.eligible:
        return {"error": f"{b.bed_code} does not fit {p.patient_code}: " + "; ".join(u["text"] for u in ev.unmet)}
    return {"card": {"kind": "ALLOCATION", "patient_id": p.id, "patient_code": p.patient_code, "patient_name": p.display_name,
                     "bed_id": b.id, "bed_code": b.bed_code, "ward_name": ctx.ward_by_id[b.ward_id].name, "score": ev.score,
                     "devices": [d["equipment_code"] for d in ev.devices], "reasons": ev.matches[:4]},
            "note": "Proposal card shown to staff for confirmation."}


TOOLS: dict[str, tuple[Callable[[Session, dict], dict], dict]] = {
    "get_hospital_summary": (t_summary, {
        "description": "Live bed counts by status, per-ward availability and occupancy, the waiting queue and device counts.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "find_beds": (t_find_beds, {
        "description": "List beds filtered by ward, status, bed type and feature. Status defaults to AVAILABLE; use ANY for all.",
        "input_schema": {"type": "object", "additionalProperties": False, "properties": {
            "ward": {"type": "string", "description": "Ward name or bed-code prefix, e.g. 'ICU' or 'W1'"},
            "status": {"type": "string", "enum": ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE", "ANY"]},
            "bed_type": {"type": "string", "enum": BED_TYPES},
            "feature": {"type": "string", "enum": BED_FEATURES}}}}),
    "get_waiting_patients": (t_waiting, {
        "description": "Patients waiting for a bed, highest staff-set priority first, with their requirements and how many beds fit now.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "recommend_beds": (t_recommend, {
        "description": "Top suitable beds for one waiting patient with match scores and reasons, plus why other beds were rejected.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["patient_code"],
                         "properties": {"patient_code": {"type": "string", "description": "e.g. P-9003"}}}}),
    "get_equipment_status": (t_equipment, {
        "description": "Device availability by type (Monitor, Ventilator, Infusion Pump) and counted stock.",
        "input_schema": {"type": "object", "additionalProperties": False,
                         "properties": {"equipment_type": {"type": "string", "enum": DEVICE_TYPES}}}}),
    "get_alerts": (t_alerts, {
        "description": "Current operational alerts (low availability, shortages, no suitable bed, maintenance).",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "get_capacity_forecast": (t_forecast, {
        "description": "Simulated occupancy projection per ward for the next hours, with peak and risk level.",
        "input_schema": {"type": "object", "additionalProperties": False, "properties": {
            "hours": {"type": "integer", "minimum": 6, "maximum": 72},
            "demand_factor": {"type": "number", "minimum": 0, "maximum": 3, "description": "1 = normal demand, 1.5 = surge"}}}}),
    "get_allocation_plan": (t_plan, {
        "description": "The AI's proposed placement for the whole waiting queue, with reasons, and fixes for patients it cannot place.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "propose_allocation": (t_propose, {
        "description": "Show staff a confirmation card for placing a waiting patient in a bed. Validates the fit; does not save anything.",
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["patient_code", "bed_code"],
                         "properties": {"patient_code": {"type": "string"}, "bed_code": {"type": "string"}}}}),
}


def run_tool(s: Session, name: str, args: dict) -> dict:
    fn = TOOLS.get(name)
    if not fn:
        return {"error": f"Unknown tool {name}"}
    try:
        return fn[0](s, args or {})
    except Exception as e:  # noqa: BLE001  (a tool error is reported to the model, not raised)
        return {"error": str(e)}


# ------------------------------------------------------------------ engines
def chat(db, messages: list[dict]) -> dict:  # noqa: ANN001
    history = [m for m in messages if m.get("role") in ("user", "assistant") and str(m.get("content", "")).strip()][-12:]
    if not history or history[-1]["role"] != "user":
        return {"reply": "Ask me about beds, equipment, the waiting queue or the forecast.", "cards": [], "engine": "local",
                "suggestions": SUGGESTIONS}
    if config.GROQ_API_KEY:
        try:
            return _groq_chat(db, history)
        except Exception as e:  # noqa: BLE001  — fall back so the assistant always answers
            out = _local_chat(db, history[-1]["content"])
            out["notice"] = f"Groq unavailable ({type(e).__name__}); answered with the built-in engine."
            return out
    return _local_chat(db, history[-1]["content"])


def _groq_tools() -> list[dict]:
    """The read-only tools in the OpenAI-compatible function format Groq expects."""
    return [{"type": "function", "function": {"name": n, "description": spec["description"], "parameters": spec["input_schema"]}}
            for n, (_fn, spec) in TOOLS.items()]


def _groq_chat(db, history: list[dict]) -> dict:  # noqa: ANN001
    from groq import Groq

    client = Groq(api_key=config.GROQ_API_KEY, timeout=45.0, max_retries=2)
    msgs: list[Any] = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs += [{"role": m["role"], "content": str(m["content"])[:4000]} for m in history]
    cards: list[dict] = []
    used: list[str] = []
    message = None
    for _ in range(8):
        response = client.chat.completions.create(
            model=config.GROQ_MODEL, messages=msgs, tools=_groq_tools(), tool_choice="auto",
            reasoning_effort="low", max_completion_tokens=4096, temperature=0.2)
        message = response.choices[0].message
        calls = message.tool_calls or []
        if not calls:
            break
        msgs.append({"role": "assistant", "content": message.content or "",
                     "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments or "{}"}} for c in calls]})
        with db.read() as s:
            for c in calls:
                used.append(c.function.name)
                try:
                    args = json.loads(c.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = None
                out = run_tool(s, c.function.name, args) if isinstance(args, dict) else {"error": "Tool arguments were not valid JSON."}
                if "card" in out:
                    cards.append(out["card"])
                msgs.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(out, default=str)[:20000]})
    text = (message.content or "").strip() if message else ""
    # gpt-oss likes typographic hyphens/spaces; keep bed and patient codes plain so they copy and search cleanly
    text = text.translate({0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2013: "-", 0x00A0: " ", 0x202F: " "})
    return {"reply": text or "Done.", "cards": cards, "engine": "groq", "model": config.GROQ_MODEL, "tools_used": used, "suggestions": []}


SUGGESTIONS = [
    "How many beds are free right now?",
    "Where should P-9003 go?",
    "Plan beds for the whole queue",
    "Are we short on ventilators?",
    "Which ward will be under pressure today?",
    "Show free ICU beds",
]


def _fmt_bullets(lines: list[str]) -> str:
    return "\n".join(f"• {ln}" for ln in lines)


def _local_chat(db, text: str) -> dict:  # noqa: ANN001
    q = text.lower()
    cards: list[dict] = []
    with db.read() as s:
        ctx = Ctx(s)
        pcode = re.search(r"\bp-?\s?(\d{3,5})\b", q)
        bcode = re.search(r"\b([a-z]{1,4}\d?-\d{3})\b", q)
        ward = next((w for w in ctx.wards if re.search(rf"\b{re.escape(w.name.lower())}\b", q)
                     or re.search(rf"\b{re.escape(w.bed_code_prefix.lower())}\b", q)), None)
        btype = next((t for t in BED_TYPES if t.lower() in q or (t == "Pediatric" and "paed" in q)), None)
        dtype = next((t for t in DEVICE_TYPES if t.lower().split()[0] in q), None)

        # --- where should P-xxxx go
        if pcode:
            code = f"P-{pcode.group(1)}"
            r = t_recommend(s, {"patient_code": code})
            if "error" in r:
                reply = r["error"]
            elif "note" in r:
                reply = f"{code} is {r['status'].lower()}" + (f" in {r['bed_code']}." if r.get("bed_code") else ".")
            elif not r["top"]:
                from .ai import unlock_for_patient

                u = unlock_for_patient(s, next(p.id for p in ctx.patients if p.patient_code == code))
                reply = f"No suitable bed for {code} right now.\n" + _fmt_bullets(u["blockers"]) + "\n\nWhat would unblock it:\n" + _fmt_bullets(
                    [f"{x['label']} — {x['detail']}" for x in u["unlock"]])
            else:
                best = r["top"][0]
                prop = t_propose(s, {"patient_code": code, "bed_code": best["bed_code"]})
                if "card" in prop:
                    cards.append(prop["card"])
                others = ", ".join(f"{x['bed_code']} ({x['score']})" for x in r["top"][1:4])
                reply = (f"Best fit for {code} ({r['name']}, {r['priority'].lower()} priority): **{best['bed_code']}** in {best['ward']} "
                         f"— match score {best['score']}/100.\n" + _fmt_bullets(best["why"]) +
                         (f"\n\nAlternatives: {others}." if others else "") + f"\n{r['eligible_count']} beds fit in total. Confirm below to allocate.")
            return _out(reply, cards)

        # --- a specific bed
        if bcode:
            code = bcode.group(1).upper()
            b = next((x for x in ctx.beds if x.bed_code == code), None)
            if not b:
                return _out(f"I couldn't find bed {code}.")
            p = ctx.patient_by_id.get(b.current_patient_id) if b.current_patient_id else None
            reply = (f"**{b.bed_code}** · {ctx.ward_by_id[b.ward_id].name} · {b.bed_type} bed · {b.status.lower()}"
                     + (f" · {p.patient_code} ({p.display_name})" if p else "")
                     + (f"\nFeatures: {', '.join(b.features)}" if b.features else ""))
            cards.append({"kind": "BED", "bed_id": b.id, "bed_code": b.bed_code, "ward_id": b.ward_id})
            return _out(reply, cards)

        # --- plan the whole queue
        if re.search(r"\b(plan|allocate all|auto.?allocat|whole queue|everyone|optimi[sz]e)\b", q):
            p = t_plan(s, {})
            if not p["waiting"]:
                return _out("Nobody is waiting for a bed right now.")
            lines = [f"{a['patient_code']} → {a['bed_code']} ({a['ward']}, score {a['score']})" for a in p["assignments"][:8]]
            reply = (f"I can place **{p['placed']} of {p['waiting']}** waiting patients now"
                     + (f" — {p['placed'] - p['baseline_placed']} more than first-come-first-served" if p["placed"] > p["baseline_placed"] else "")
                     + ".\n" + _fmt_bullets(lines))
            if p["unplaced_patients"]:
                reply += "\n\nNeeds action:\n" + _fmt_bullets([f"{u['patient_code']}: {u['blockers'][0]} → {u['fixes'][0]}" for u in p["unplaced_patients"]])
            cards.append({"kind": "OPEN_PLAN", "placed": p["placed"], "waiting": p["waiting"]})
            return _out(reply, cards)

        # --- equipment
        if dtype or re.search(r"\b(equipment|device|devices|short|shortage)\b", q):
            e = t_equipment(s, {"equipment_type": dtype} if dtype else {})
            lines = []
            for t, c in e["devices"].items():
                flag = " ⚠ tight" if c["AVAILABLE"] < c["waiting_patients_needing"] + 2 else ""
                lines.append(f"{t}: {c['AVAILABLE']} available · {c['IN_USE']} in use · {c['MAINTENANCE']} maintenance"
                             + (f" · {c['waiting_patients_needing']} waiting patients need one" if c["waiting_patients_needing"] else "") + flag)
            if not dtype:
                lines += [f"{x['type']}: {x['available']}/{x['total']} in stock" for x in e["stock"]]
            return _out(("Equipment right now:\n" if not dtype else "") + _fmt_bullets(lines))

        # --- forecast
        if re.search(r"\b(forecast|predict|tomorrow|tonight|next|later|pressure|surge|projection|expect)\b", q):
            demand = 1.5 if "surge" in q else 1.0
            f = t_forecast(s, {"hours": 24, "demand_factor": demand})
            ws = sorted(f["wards"], key=lambda w: -w["peak_pct"])
            lines = [f"{w['name']}: {round(w['now_pct'])}% now → peak {round(w['peak_pct'])}% at {w['peak_label']} ({w['risk']})" for w in ws]
            reply = ("24-hour projection" + (" with 1.5× surge demand" if demand > 1 else "") + " (simulated planning assumptions):\n"
                     + _fmt_bullets(lines))
            cards.append({"kind": "OPEN_FORECAST"})
            return _out(reply, cards)

        # --- alerts
        if re.search(r"\b(alert|alerts|risk|problem|issue|warning|attention)\b", q):
            a = t_alerts(s, {})
            if not a["count"]:
                return _out("No alerts right now.")
            return _out(f"{a['count']} active alert{'s' if a['count'] != 1 else ''}:\n" + _fmt_bullets([f"{x['title']} — {x['detail']}" for x in a["alerts"][:6]]))

        # --- waiting queue
        if re.search(r"\b(wait|waiting|queue|pending|admission|admissions)\b", q):
            w = t_waiting(s, {})
            if not w["count"]:
                return _out("Nobody is waiting for a bed.")
            lines = [f"{p['patient_code']} · {p['priority'].lower()} · needs {p['needs_bed_type']}"
                     + (f" + {', '.join(p['needs_equipment'])}" if p["needs_equipment"] else "")
                     + f" · {p['suitable_beds_now']} beds fit · waiting {p['waiting_minutes']} min" for p in w["patients"][:10]]
            return _out(f"{w['count']} patient{'s' if w['count'] != 1 else ''} waiting:\n" + _fmt_bullets(lines))

        # --- availability
        if re.search(r"\b(free|available|availability|capacity|empty|vacant|beds?|occupancy|occupied|how many)\b", q) or ward or btype:
            status = "OCCUPIED" if "occupied" in q else "CLEANING" if "clean" in q else "MAINTENANCE" if "maint" in q else "RESERVED" if "reserv" in q else "AVAILABLE"
            feature = next((f for f in BED_FEATURES if f.split()[0].lower() in q), None)
            r = t_find_beds(s, {"ward": ward.name if ward else None, "status": status, "bed_type": btype, "feature": feature})
            scope = r["ward"] if ward else (f"{btype} beds" if btype else "all wards")
            reply = f"**{r['count']}** {status.lower()} bed{'s' if r['count'] != 1 else ''} in {scope}" + (f" with {feature}" if feature else "") + "."
            if not ward and not btype and status == "AVAILABLE":
                sm = t_summary(s, {})
                reply += "\n" + _fmt_bullets([f"{w['name']}: {w['available']} free of {w['beds']} ({w['occupancy_pct']}% occupied)" for w in sm["wards"]])
            elif r["beds"]:
                reply += "\n" + ", ".join(b["bed_code"] for b in r["beds"][:15]) + ("…" if r["truncated"] or r["count"] > 15 else "")
            if ward:
                cards.append({"kind": "OPEN_WARD", "ward_id": ward.id, "ward_name": ward.name})
            return _out(reply, cards)

        # --- fallback: situation report
        b = briefing(s)
        return _out(b["headline"] + "\n\nTry asking:\n" + _fmt_bullets(SUGGESTIONS[:4]))


def _out(reply: str, cards: list[dict] | None = None) -> dict:
    return {"reply": reply, "cards": cards or [], "engine": "local", "suggestions": SUGGESTIONS}
