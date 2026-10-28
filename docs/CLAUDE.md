# Instructions for Claude Code — MediTwin

Read `PRD.md`, `TRD.md`, and `reference/UI_REFERENCE_NOTES.md` before implementing features. Use `reference/meditwin_ui_reference.png` as the current approved visual reference.

## Non-negotiable product definition

MediTwin is a **data-driven 3D resource inventory**, not a hospital interior simulator. The hospital enters ward names, bed counts/types, and equipment inventory. The app automatically lays out simplified 3D resources in a tidy grid so staff can inspect availability and allocate resources.

Never build realistic hospital architecture: no walls, corridors, doors, windows, chairs, plants, reception areas, room decorations, or physical bed coordinates. Do not imply that generated row/column positions represent where beds physically are. Any section or group is only a visual grouping for handling many resources.

## How to work

1. Inspect the existing repository and report its framework, scripts, and current state before changing files.
2. Preserve useful existing code. Do not overwrite or recreate the project without need.
3. Read the PRD/TRD fully and implement the app in small, testable phases.
4. Make the application run locally early. Prefer a working vertical slice to multiple unfinished screens.
5. Use TypeScript types and consistent API schemas. Keep business rules in backend services, not only in UI components.
6. Make buttons and controls functional. Do not use fake interactions, unrelated placeholder pages, or hardcoded summary numbers for the final result.
7. Keep all dashboard figures and resource statuses derived from the same stored data.
8. Seed fictional demo data, and make seeding repeatable without creating duplicates.
9. Use transparent rule-based bed recommendations. Authorized staff confirm allocations; the system does not diagnose or triage patients.
10. Add tests for critical logic and run available checks after each phase.
11. If a requirement is unclear, choose the simplest solution consistent with the PRD and state your assumption; do not stop for small choices.
12. Do not claim tests passed unless they were actually run. Report blockers and known limitations honestly.

## Visual rules

- Use a polished, light blue/white interface with navy text, blue primary actions, rounded cards, and clear status chips.
- Show stylized beds/equipment on a blank or abstract stage, not inside realistic rooms.
- Build the visual grid from data. For 100 beds, use a readable grid or groups and ensure any bed ID can be found by search.
- A selected resource opens a useful details panel.
- Provide a 2D list/grid fallback for accessibility and fast lookup.
- Treat the supplied image as styling guidance, not as a static picture to embed in place of the actual app. Don't copy accidental text errors or sample numbers from the image.

## Data-integrity rules

- A bed cannot be assigned if it is occupied, reserved, cleaning, or under maintenance.
- The backend must recheck eligibility at confirmation time.
- A bed and single-unit equipment cannot be allocated twice.
- Allocation must be transactional and must not leave partially changed records.
- Releasing a patient must update the allocation, patient, and bed state consistently.
- Bed count changes must not delete resources with active allocations.
- Use fictional data; never request or seed real patient information.

## End-of-phase report

After each phase, state what changed, which commands were run, what tests passed/failed, how to run the app, and what remains. Continue to the next phase only when asked or when the current staged prompt explicitly requests it.
