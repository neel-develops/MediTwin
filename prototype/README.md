# MediTwin — Smarter Hospital Resource Allocation

Hackathon prototype: a **data-driven 3D resource inventory**. A hospital configures wards and bed counts; MediTwin lays the beds out automatically in a tidy, selectable 3D grid so staff can see availability, find a bed by ID, and allocate beds to (fictional) patients using transparent rules.

> Demo only. All data is fictional and stored in your browser. Not clinically validated, not connected to any hospital system. Grid positions are display positions, not physical locations.

## Run it

No installs needed (Windows):

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:5173/ (tests: http://localhost:5173/tests.html).

Any static file server also works (for example `npx serve` or `python -m http.server 5173` if you have Node or Python). An internet connection is needed for Three.js (loaded from jsDelivr) and the Inter font. If Three.js can't load, Bed Allocations falls back to the list view.

Old links keep working: `#/explorer` and `#/dashboard` redirect to `#/allocations`.

**Design:** "Graphite" dark glass theme. The whole UI, including the 3D beds, uses exactly 10 colours defined once at the top of `styles.css` (and mirrored in `js/scene.js`): base `#111315`, panel `#1b1f23`, raised `#2c3238`, slate `#4f6e85`, fog `#8da4b3`, pearl `#eef3f6`, accent `#7db4e6`, mint `#5ed3a5`, coral `#f3786a`, amber `#f4c35a`. The original concept with dark/light background options is at `concepts/midnight-ward.html`.

## What's included

| Area | Where |
|---|---|
| **Bed Allocations** (opens by default): 3D bed inventory with auto-laid-out sections, click to select, zoom/rotate/pan/reset, auto-rotate, status chips as filters, bed-ID search, list (2D) fallback, detail panel with Details/Equipment/Patient tabs and valid actions, ward overview, recent activity, quick actions and alerts. An all-wards bed table is at `#/beds`. | `#/allocations` |
| Patient Flow: Waiting → Matching → Allocated → Admitted board with live counts, priority/care/bed-type/ward filters, search and paging; details panel with ranked bed matches; "See in 3D" highlights only suitable beds and lets you confirm the allocation there; admit, cancel, discharge/transfer | `#/patients` |
| Equipment: individually tracked devices (Monitor, Ventilator, Infusion Pump) and counted stock | `#/equipment` |
| Alerts & activity log | `#/alerts` |
| Reports: occupancy, equipment utilization, allocation history, **simulated** demand surge (writes nothing) | `#/reports` |
| Setup: create/edit/deactivate wards, set bed count safely, seed/reset demo data, data-consistency check | `#/setup` |
| Settings: alert thresholds, device minimums, visual section size, release-to-cleaning rule, bed-type compatibility | `#/settings` |

Global search (top bar) finds beds, wards, equipment and patients.

## Architecture

The TRD recommends React + FastAPI + SQLite. This machine had no Node.js or Python, so this version runs with no build step, but keeps the TRD's separation:

- `js/services.js` — the **backend-equivalent service layer**. It owns every business rule: allowed status transitions, recommendation and eligibility, transactional allocation and release, safe bed-count changes, uniqueness, alerts and the idempotent seed. Each mutation re-reads the latest stored state, applies the change to a draft, runs integrity checks (one active allocation per bed and per patient, bed, patient and device states consistent, unique codes), then commits with a single write. Any failure writes nothing. Errors are structured (`ApiError` with HTTP-style `status` and `code`, e.g. 409 `BED_UNAVAILABLE`). Its methods mirror the TRD's REST endpoints, so it can be ported to FastAPI almost one-for-one.
- `js/scene.js` — Three.js stage. One stylized bed per stored bed with shared geometry and materials. The layout is computed from the bed's order in its ward (never stored). Group labels are culled so they don't overlap.
- `js/app.js` — UI. Every figure is read back from the service layer, never hardcoded.
- `tests.html` + `js/tests.js` — 27 tests for the TRD §12 list. Each runs against an isolated in-memory store.

### Allocation rules (resource compatibility, not clinical judgment)

A bed is recommended only if: its ward is active, it is `AVAILABLE` with no active allocation, its type matches (or is configured as compatible in Settings), it has every required bed feature, and each required device type has an `AVAILABLE` device in the bed's ward or the shared pool. Ranking prefers exact type, devices in the same ward, and beds that don't tie up features the patient doesn't need. All of this is rechecked at confirmation. Releasing sends the bed to `CLEANING` by default (configurable).

### Demo data

Ward 1 (100 beds), Ward 2 (40), ICU (20), Pediatrics (30) and Maternity (15) have a mix of statuses and consistent fictional patients and allocations. There are 114 devices, counted stock, and 8 waiting patients, including one Isolation request that no bed can meet, to demonstrate "no suitable bed". Use **Setup → Add missing demo data** to re-run the seed (it never duplicates), or **Reset demo data** to start over.

## Known limitations

- Data lives in browser `localStorage`, per browser profile. It persists across reloads and restarts but isn't shared between users or devices. Two tabs in the same browser are protected: each change re-reads the latest state, and a conflicting allocation gets a 409.
- No real authentication. "Demo Staff" is a demo role.
- Not yet ported to the TRD's FastAPI/SQLite stack. `services.js` is designed to be that port's blueprint.

Spec documents are in `docs/`.
