# Staged prompts for Claude Code

Paste these prompts **one at a time**, in order. Keep `PRD.md`, `TRD.md`, `CLAUDE.md`, and `reference/meditwin_ui_reference.png` in the repository.

---

## Prompt 1 — Inspect the repository and build the base app

Read `CLAUDE.md`, `PRD.md`, `TRD.md`, and `reference/UI_REFERENCE_NOTES.md`. Inspect the current repository before making changes. Summarize the current stack and your implementation plan, then implement the base project structure and a polished dashboard shell using the current UI reference. Do not build a realistic hospital interior. Create a data-driven layout with left navigation, ward selector, search, status summary cards, a central placeholder for the resource grid, and a right detail panel. Set up frontend/backend startup instructions and a simple health check. Preserve existing code if the repository is already initialized. Run the available checks and tell me exactly how to launch the app. Keep the first phase focused and working.

## Prompt 2 — Ward setup, data model, and generated bed inventory

Implement ward setup and persistent demo data according to the PRD/TRD. A user must be able to create/edit wards and generate a requested number of beds with unique IDs such as `W1-001` through `W1-100`. Seed Ward 1 with 100 beds and a few additional wards. Make the seed operation repeatable without creating duplicates. Build the organized bed grid from API/database records, not hardcoded UI arrays. Use display groupings only for navigation; they are not physical room locations. Add filters and status totals derived from the same records. Test bed generation and safe count changes.

## Prompt 3 — Implement the interactive 3D resource grid

Replace the central placeholder with an actual interactive 3D resource inventory using React Three Fiber/Three.js or the compatible 3D framework already in the repo. Show simple stylized beds on a clean abstract background. Do not create hospital walls, rooms, corridors, architecture, or physical position semantics. Automatically arrange resources in a readable grid and add visual grouping for large wards. Implement click-to-select, clear selected state, zoom, rotate, reset view, useful min/max camera bounds, and a non-3D list/search alternative. Selecting a model must open the detail panel for the matching stored bed ID. Ensure 100 beds remain usable and avoid overlapping labels. Run the app and correct visual issues before finishing this phase.

## Prompt 4 — Bed details, status changes, patients, and allocation

Implement working bed detail tabs/panels, status changes, synthetic patient registration, bed recommendations, allocation confirmation, and release. Keep business rules in backend services. The recommendation engine must be deterministic and explain the bed-type/equipment matches; it must not make clinical decisions. Reject beds that are occupied, reserved, cleaning, or in maintenance. Recheck eligibility inside a database transaction when confirming. Prevent two requests from allocating the same bed or single-unit equipment. Update the database, patient, bed, counts, explorer, and activity history consistently. Add tests for success and invalid/conflicting allocations.

## Prompt 5 — Equipment, alerts, analytics, and final polish

Implement equipment inventory and allocation checks, alerts based on stored states and configurable/demo thresholds, a basic activity history, and simple occupancy/equipment analytics. Add responsive behavior, loading/empty/error/success states, keyboard focus, text labels for colors, and a clean fallback list for the 3D explorer. Add a clearly labeled simulated demand-surge demo only after the core flow works. Test the main journey end to end, fix issues, update README setup commands, and report actual test results and known limitations. Do not imply real hospital integration or clinical validation.

---

## If Claude starts making a realistic hospital

Stop it and paste:

> Stop: this violates the product definition. MediTwin must show only a data-generated inventory of selectable beds and equipment, organized into a tidy grid. Remove all realistic building interiors, room geometry, walls, corridors, furniture, physical coordinates, and floor-plan behavior. Keep only optional ward and visual group selection. The position of an item in the grid is not its real-world location. Rework the current implementation to match `CLAUDE.md` and `reference/UI_REFERENCE_NOTES.md`, then run the app and show the corrected result.
