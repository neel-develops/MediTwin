"""Backend tests for TRD §12 plus the AI planner. Each test gets a fresh seeded database."""
from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(tmp_path / "test.db", seed=True, frontend=tmp_path / "no-dist")
    with TestClient(app) as c:
        yield c


def waiting(c, code):
    return next(p for p in c.get("/api/patients", params={"status": "WAITING"}).json() if p["patient_code"] == code)


def first_rec(c, pid):
    r = c.get("/api/allocations/recommendations", params={"patient_id": pid}).json()
    assert r["recommendations"], r
    return r["recommendations"][0]


def no_integrity_alerts(c):
    return not [a for a in c.get("/api/alerts").json() if a["kind"] == "ALLOCATION_CONFLICT"]


# ---------------------------------------------------------------- codes & generation
def test_seed_is_idempotent(client):
    before = client.get("/api/dashboard/summary").json()
    created = client.post("/api/demo/seed").json()
    assert created == {"wards": 0, "beds": 0, "patients": 0, "equipment": 0}
    after = client.get("/api/dashboard/summary").json()
    assert before["beds"] == after["beds"] and before["patients"] == after["patients"]


def test_unique_codes_enforced(client):
    r = client.post("/api/wards", json={"name": "ward 1", "bed_count": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "DUPLICATE"
    r = client.post("/api/wards", json={"name": "Annex", "bed_code_prefix": "W1", "bed_count": 1})
    assert r.status_code == 409
    r = client.post("/api/patients", json={"display_name": "Test", "patient_code": "P-9001"})
    assert r.status_code == 409
    r = client.post("/api/equipment", json={"tracking_mode": "INDIVIDUAL", "equipment_type": "Monitor", "equipment_code": "MON-001"})
    assert r.status_code == 409


def test_generate_beds_creates_requested_count(client):
    w = client.post("/api/wards", json={"name": "Surge Annex", "bed_count": 12, "bed_type": "General"}).json()
    assert w["bed_count"] == 12 and w["bed_code_prefix"] == "SA"
    beds = client.get("/api/beds", params={"ward_id": w["id"]}).json()
    assert [b["bed_code"] for b in beds][:2] == ["SA-001", "SA-002"] and len(beds) == 12
    r = client.post(f"/api/wards/{w['id']}/generate-beds", json={"count": 30}).json()
    assert r["bed_count"] == 30 and r["added"][0] == "SA-013"
    r = client.post(f"/api/wards/{w['id']}/generate-beds", json={"count": 5}).json()
    assert r["bed_count"] == 5 and len(r["removed"]) == 25


def test_unsafe_reduction_rejected(client):
    ward1 = client.get("/api/wards").json()[0]
    r = client.post(f"/api/wards/{ward1['id']}/generate-beds", json={"count": 0})
    assert r.status_code == 409 and r.json()["error"]["code"] == "UNSAFE_REDUCTION"
    assert client.get(f"/api/wards/{ward1['id']}").json()["bed_count"] == 100  # nothing removed


def test_validation_errors_are_structured(client):
    r = client.post("/api/wards", json={"name": "", "bed_count": 3})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION"
    r = client.post("/api/wards", json={"name": "Big", "bed_count": 9999})
    assert r.status_code == 422
    r = client.get("/api/beds/999999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------- allocation rules
def test_ineligible_status_rejected(client):
    p = waiting(client, "P-9002")
    for status in ("OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"):
        bed = next(b for b in client.get("/api/beds", params={"status": status, "bed_type": "General"}).json())
        r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": bed["id"]})
        assert r.status_code == 409 and r.json()["error"]["code"] == "BED_UNAVAILABLE", status


def test_type_and_equipment_mismatch_rejected(client):
    p = waiting(client, "P-9003")  # ICU + Monitor + Ventilator
    general = next(b for b in client.get("/api/beds", params={"status": "AVAILABLE", "bed_type": "General"}).json())
    r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": general["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "REQUIREMENT_MISMATCH"
    # Take every available ventilator out of service, then try an ICU bed.
    for e in client.get("/api/equipment", params={"type": "Ventilator", "status": "AVAILABLE"}).json():
        assert client.patch(f"/api/equipment/{e['id']}", json={"status": "MAINTENANCE"}).status_code == 200
    icu = next(b for b in client.get("/api/beds", params={"status": "AVAILABLE", "bed_type": "ICU"}).json())
    r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": icu["id"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EQUIPMENT_UNAVAILABLE"


def test_allocation_updates_everything_and_prevents_duplicates(client):
    p = waiting(client, "P-9001")
    rec = first_rec(client, p["id"])
    before = client.get("/api/dashboard/summary").json()["beds"]
    r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": rec["bed_id"]})
    assert r.status_code == 201, r.json()
    alloc = r.json()
    bed = client.get(f"/api/beds/{rec['bed_id']}").json()
    assert bed["status"] == "OCCUPIED" and bed["patient"]["patient_code"] == "P-9001"
    assert all(d["status"] == "IN_USE" for d in bed["devices"]) and len(bed["devices"]) == 1
    after = client.get("/api/dashboard/summary").json()["beds"]
    assert after["OCCUPIED"] == before["OCCUPIED"] + 1 and after["AVAILABLE"] == before["AVAILABLE"] - 1
    # same bed again (another patient) and same patient again
    other = waiting(client, "P-9002")
    r = client.post("/api/allocations", json={"patient_id": other["id"], "bed_id": rec["bed_id"]})
    assert r.status_code == 409
    another_bed = first_rec(client, other["id"])
    r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": another_bed["bed_id"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "PATIENT_NOT_WAITING"
    assert alloc["source"] == "MANUAL" and alloc["match_score"] > 0
    assert no_integrity_alerts(client)


def test_competing_allocations_conflict(client):
    a, b = waiting(client, "P-9002"), waiting(client, "P-9010")
    bed = next(x for x in client.get("/api/beds", params={"status": "AVAILABLE", "bed_type": "General"}).json() if "Oxygen Outlet" in x["features"])
    results: list[int] = []
    barrier = threading.Barrier(2)

    def go(pid):
        barrier.wait()
        results.append(client.post("/api/allocations", json={"patient_id": pid, "bed_id": bed["id"]}).status_code)

    threads = [threading.Thread(target=go, args=(pid,)) for pid in (a["id"], b["id"])]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201, 409]
    active = [x for x in client.get("/api/allocations", params={"status": "ACTIVE", "limit": 500}).json() if x["bed_id"] == bed["id"]]
    assert len(active) == 1
    assert no_integrity_alerts(client)


def test_admit_release_and_cancel(client):
    p = waiting(client, "P-9002")
    rec = first_rec(client, p["id"])
    alloc = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": rec["bed_id"]}).json()
    assert client.post(f"/api/allocations/{alloc['id']}/admit").status_code == 200
    assert client.post(f"/api/allocations/{alloc['id']}/cancel").status_code == 409  # admitted: must discharge instead
    r = client.post(f"/api/allocations/{alloc['id']}/release", json={"outcome": "DISCHARGED"}).json()
    assert r["bed_status"] == "CLEANING"
    assert client.get(f"/api/patients/{p['id']}").json()["status"] == "DISCHARGED"
    assert client.get(f"/api/beds/{rec['bed_id']}").json()["status"] == "CLEANING"
    assert client.post(f"/api/allocations/{alloc['id']}/release", json={}).status_code == 409

    q = waiting(client, "P-9011")
    rec2 = first_rec(client, q["id"])
    a2 = client.post("/api/allocations", json={"patient_id": q["id"], "bed_id": rec2["bed_id"]}).json()
    assert client.post(f"/api/allocations/{a2['id']}/cancel").status_code == 200
    assert client.get(f"/api/beds/{rec2['bed_id']}").json()["status"] == "AVAILABLE"
    assert client.get(f"/api/patients/{q['id']}").json()["status"] == "WAITING"
    assert no_integrity_alerts(client)


def test_bed_status_transitions(client):
    bed = next(b for b in client.get("/api/beds", params={"status": "AVAILABLE"}).json())
    assert client.patch(f"/api/beds/{bed['id']}/status", json={"status": "OCCUPIED"}).status_code == 409
    assert client.patch(f"/api/beds/{bed['id']}/status", json={"status": "CLEANING"}).json()["status"] == "CLEANING"
    assert client.patch(f"/api/beds/{bed['id']}/status", json={"status": "RESERVED"}).status_code == 409
    occ = next(b for b in client.get("/api/beds", params={"status": "OCCUPIED"}).json())
    assert client.patch(f"/api/beds/{occ['id']}/status", json={"status": "AVAILABLE"}).status_code == 409


def test_integrity_endpoint(client):
    r = client.get("/api/integrity").json()
    assert r == {"ok": True, "problems": []}


def test_dashboard_totals_match_records(client):
    s = client.get("/api/dashboard/summary").json()
    beds = client.get("/api/beds").json()
    assert s["beds"]["total"] == len(beds)
    for st in ("AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE"):
        assert s["beds"][st] == sum(1 for b in beds if b["status"] == st)
        assert s["beds"][st] == sum(w["counts"][st] for w in s["wards"])
    devices = [e for e in client.get("/api/equipment", params={"tracking_mode": "INDIVIDUAL"}).json()]
    assert s["equipment"]["devices"]["total"] == len(devices)
    waiting_n = len(client.get("/api/patients", params={"status": "WAITING"}).json())
    assert s["queue"]["waiting"] == waiting_n


def test_data_persists_across_restart(tmp_path):
    path = tmp_path / "persist.db"
    with TestClient(create_app(path, seed=True, frontend=tmp_path / "x")) as c:
        w = c.post("/api/wards", json={"name": "Persist Ward", "bed_count": 3}).json()
    with TestClient(create_app(path, seed=True, frontend=tmp_path / "x")) as c:
        assert c.get(f"/api/wards/{w['id']}").json()["name"] == "Persist Ward"
        assert c.get("/api/dashboard/summary").json()["beds"]["total"] == 208


# ---------------------------------------------------------------- AI
def test_ai_plan_is_valid_and_applies(client):
    plan = client.get("/api/ai/plan").json()
    assert plan["placed"] > plan["baseline_placed"]  # demo scenario: FCFS strands P-9009, the AI doesn't
    assert any(i["patient_code"] == "P-9009" and i["bed_code"] == "ICU-002" for i in plan["items"])
    beds = [i["bed_id"] for i in plan["items"]]
    assert len(beds) == len(set(beds))  # no bed planned twice
    devs = [d["id"] for i in plan["items"] for d in i["devices"]]
    assert len(devs) == len(set(devs))  # no device planned twice
    urgent = [i for i in plan["items"] if i["priority"] == "URGENT"]
    assert all(i["step"] <= len(urgent) for i in urgent)  # urgent tier planned first
    assert any(u["patient_code"] == "P-9007" for u in plan["unplaced_patients"])  # no isolation beds in demo
    r = client.post("/api/ai/plan/apply", json={"items": [{"patient_id": i["patient_id"], "bed_id": i["bed_id"]} for i in plan["items"]]}).json()
    assert r["confirmed"] == plan["placed"] and r["failed"] == 0
    assert no_integrity_alerts(client)
    # Applying the same plan again must fail safely, row by row.
    r2 = client.post("/api/ai/plan/apply", json={"items": [{"patient_id": i["patient_id"], "bed_id": i["bed_id"]} for i in plan["items"]]}).json()
    assert r2["confirmed"] == 0 and r2["failed"] == plan["placed"]


def test_unlock_suggests_compatible_type(client):
    p = waiting(client, "P-9007")
    u = client.get(f"/api/ai/unlock/{p['id']}").json()
    assert u["blockers"] and u["unlock"]
    compat = next((x for x in u["unlock"] if x["kind"] == "COMPAT"), None)
    if compat:
        client.patch("/api/settings", json={"bed_type_compat": {"Isolation": ["Isolation", compat["add_type"]]}})
        assert client.get("/api/allocations/recommendations", params={"patient_id": p["id"]}).json()["eligible_count"] > 0


def test_isolation_substitute_must_be_isolation_capable(client):
    client.patch("/api/settings", json={"bed_type_compat": {"Isolation": ["Isolation", "General"]}})
    p = waiting(client, "P-9007")
    recs = client.get("/api/allocations/recommendations", params={"patient_id": p["id"], "limit": 100}).json()
    assert recs["eligible_count"] > 0
    assert all("Isolation Capable" in r["features"] for r in recs["recommendations"])
    plain = next(b for b in client.get("/api/beds", params={"status": "AVAILABLE", "bed_type": "General"}).json() if "Isolation Capable" not in b["features"])
    r = client.post("/api/allocations", json={"patient_id": p["id"], "bed_id": plain["id"]})
    assert r.status_code == 422


def test_forecast_and_briefing(client):
    f = client.get("/api/ai/forecast", params={"hours": 24}).json()
    assert len(f["series"]) == 25 and f["simulated"] is True
    assert all(0 <= w["peak_pct"] <= 100 for w in f["wards"])
    b = client.get("/api/ai/briefing").json()
    assert b["headline"] and isinstance(b["insights"], list)


def test_simulation_writes_nothing(client):
    before = client.get("/api/dashboard/summary").json()["beds"]
    r = client.post("/api/simulate/surge", params={"count": 60}).json()
    assert r["simulated"] and r["placed"] + r["unplaced"] == 60
    assert client.get("/api/dashboard/summary").json()["beds"] == before


def test_assistant_local_engine(client):
    for q in ("How many beds are free right now?", "Where should P-9003 go?", "Plan beds for the whole queue",
              "Are we short on ventilators?", "Which ward will be under pressure today?", "Show free ICU beds", "W1-001", "hello"):
        r = client.post("/api/ai/assistant", json={"messages": [{"role": "user", "content": q}]})
        assert r.status_code == 200 and r.json()["reply"], q
    r = client.post("/api/ai/assistant", json={"messages": [{"role": "user", "content": "Where should P-9003 go?"}]}).json()
    assert r["cards"] and r["cards"][0]["kind"] == "ALLOCATION"
