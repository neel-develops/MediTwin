# MediTwin — Technical Requirements Document (TRD)

**Version:** 1.0  
**Companion document:** `PRD.md`

## 1. Recommended stack

Use a practical, typed stack suitable for a hackathon and maintainable in Claude Code.

### Frontend
- React + TypeScript + Vite
- Tailwind CSS for styling (or the repository's existing styling system if one is already configured)
- Three.js with React Three Fiber for the 3D resource view
- `@react-three/drei` for common scene controls/helpers
- Zustand or an existing lightweight state solution for shared UI state
- Lucide React for icons
- Recharts for charts if analytics are implemented

### Backend
- Python + FastAPI
- Pydantic schemas for API validation
- SQLAlchemy for database operations
- SQLite for the local MVP; keep data access portable so PostgreSQL can be used later

### Testing
- Frontend unit tests: Vitest and React Testing Library
- Backend: Pytest
- End-to-end: Playwright for the main workflow if time allows

Use compatible stable package versions and commit lockfiles. Inspect the existing repository before choosing versions or replacing anything.

## 2. Architecture

### Frontend responsibilities
- Render pages, navigation, ward selector, status summaries, filters, and detail panels.
- Render bed models based on API-provided resource records.
- Map resource IDs to visual grid positions without storing those positions as physical-location data.
- Handle selection, camera controls, UI loading states, and optimistic UI only where safe.
- Refresh or invalidate related data after successful mutations.

### Backend responsibilities
- Own resource state and business rules.
- Validate patient requirements and allocation eligibility.
- Prevent duplicate allocations and concurrent conflicts.
- Persist beds, wards, patients, equipment, allocations, and activity history.
- Return consistent, structured errors.

### Database responsibilities
- Persist application state between restarts.
- Enforce unique resource codes and foreign-key relationships.
- Maintain data consistency with transactions and constraints.

The frontend must never be the only place where allocation rules are enforced.

## 3. Repository structure

Suggested initial structure; adapt to the existing repository instead of blindly replacing it.

```text
meditwin/
├── CLAUDE.md
├── PRD.md
├── TRD.md
├── README.md
├── reference/
│   ├── meditwin_ui_reference.png
│   └── UI_REFERENCE_NOTES.md
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       │   ├── layout/
│       │   ├── dashboard/
│       │   ├── explorer/
│       │   ├── resources/
│       │   ├── patients/
│       │   └── shared/
│       ├── features/
│       │   ├── wards/
│       │   ├── beds/
│       │   ├── equipment/
│       │   ├── allocation/
│       │   └── alerts/
│       ├── scene/
│       │   ├── ResourceScene.tsx
│       │   ├── BedModel.tsx
│       │   ├── EquipmentModel.tsx
│       │   ├── ResourceGrid.tsx
│       │   └── SceneControls.tsx
│       ├── services/
│       ├── stores/
│       ├── types/
│       └── main.tsx
└── backend/
    └── app/
        ├── api/
        ├── models/
        ├── schemas/
        ├── services/
        ├── database.py
        └── main.py
```

Do not create all folders in advance if they are not needed. Prefer a small, coherent implementation over excessive abstraction.

## 4. Data model

Use database-generated internal IDs (UUID or integer IDs) and separate human-readable resource codes.

### Ward
- `id`
- `name`
- `category` (optional)
- `bed_code_prefix`
- `is_active`
- `created_at`
- `updated_at`

No mandatory physical floor or room coordinates are required.

### Bed
- `id`
- `bed_code` (unique, e.g. `W1-001`)
- `ward_id`
- `bed_type`
- `status` (`AVAILABLE`, `OCCUPIED`, `RESERVED`, `CLEANING`, `MAINTENANCE`)
- `current_patient_id` (nullable)
- `required_equipment_types` (normalized relation or validated JSON field)
- `notes` (optional)
- `created_at`
- `updated_at`

### Patient
- `id`
- `patient_code` (unique)
- `display_name`
- `care_category`
- `required_bed_type`
- `required_equipment_types`
- `special_requirements` (optional structured field)
- `status` (`WAITING`, `ALLOCATED`, `DISCHARGED`, `TRANSFERRED`)
- `created_at`
- `updated_at`

### Equipment
- `id`
- `equipment_code` (unique when individually tracked)
- `equipment_type`
- `tracking_mode` (`INDIVIDUAL` or `QUANTITY`)
- `status` (`AVAILABLE`, `IN_USE`, `RESERVED`, `MAINTENANCE`)
- `quantity_total` and `quantity_available` for quantity-based items, if supported
- `ward_id` (nullable)
- `assigned_bed_id` (nullable)
- `created_at`
- `updated_at`

Do not use quantity-based and individually tracked equipment interchangeably. Model one pattern explicitly for each item.

### Allocation
- `id`
- `patient_id`
- `bed_id`
- `status` (`ACTIVE`, `RELEASED`, `CANCELLED`)
- `assigned_at`
- `released_at` (nullable)
- `confirmed_by` (nullable for local demo)

Use a database constraint or equivalent transactional guard to ensure that a bed has at most one active allocation and a patient cannot have multiple active bed allocations.

### ActivityEvent
- `id`
- `actor_label` (nullable in demo mode)
- `action`
- `resource_type`
- `resource_id`
- `details` (structured JSON/text)
- `created_at`

Optional additional tables can normalize bed-equipment requirements and patient-equipment requirements if this makes validation clearer.

## 5. Seed data

Create an idempotent seed script or startup command that can generate fictional data, including:
- Ward 1 with 100 beds
- Ward 2 with 40 beds
- ICU with 20 beds
- Pediatrics with 30 beds
- A mix of available, occupied, reserved, cleaning, and maintenance beds
- Fictional patients and sample equipment
- A small number of alerts derived from the seeded state

The exact figures should be internally consistent. If the seed command runs a second time, it should not create duplicate wards or duplicate IDs. Add an easy way to reset demo data.

## 6. REST API contract

All mutating operations must validate input and return structured errors.

### Wards
- `GET /api/wards`
- `POST /api/wards`
- `GET /api/wards/{ward_id}`
- `PATCH /api/wards/{ward_id}`
- `POST /api/wards/{ward_id}/generate-beds`

The generate-beds operation accepts a count and optional bed-type distribution/prefix. It must reject an unsafe reduction that would remove beds with active allocations.

### Beds
- `GET /api/beds?ward_id=&status=&bed_type=&search=`
- `GET /api/beds/{bed_id}`
- `PATCH /api/beds/{bed_id}/status`

### Patients
- `GET /api/patients?search=&status=`
- `POST /api/patients`
- `GET /api/patients/{patient_id}`
- `PATCH /api/patients/{patient_id}`

### Allocation
- `GET /api/allocations/recommendations?patient_id=`
- `POST /api/allocations`
- `POST /api/allocations/{allocation_id}/release`

### Equipment
- `GET /api/equipment?ward_id=&status=&type=&search=`
- `POST /api/equipment`
- `GET /api/equipment/{equipment_id}`
- `PATCH /api/equipment/{equipment_id}`

### Dashboard and events
- `GET /api/dashboard/summary`
- `GET /api/alerts`
- `GET /api/activity`

Adjust endpoint naming if the repository already has a consistent convention, but keep the behaviors and validation.

## 7. Allocation logic

Implement a deterministic rule-based service, separate from API route handlers.

For each requested patient:
1. Load active patient requirements.
2. Select only beds whose status is `AVAILABLE`.
3. Match bed type against the requested bed type and explicit compatibility rules, if any.
4. Verify all required equipment types can be supplied and are not already double-assigned.
5. Apply any explicitly configured special requirement.
6. Return eligible beds and a clear explanation of matching constraints.
7. If no bed qualifies, return an empty recommendation list with reasons where possible.

Do not label the ranking as a clinical score or medical assessment. It is only a resource-compatibility ranking.

On confirmation, the server must recheck all relevant constraints inside a transaction. Use database uniqueness constraints, locking or an equivalent transaction-safe approach to prevent concurrent requests from assigning the same bed or single-unit equipment. If another user has taken the resource, return a conflict response (HTTP 409) and ask the frontend to refresh.

Only after all validations pass should the server create the active allocation, update bed and patient states, associate any allocated equipment, and write an activity event. The operation must roll back completely if it fails.

On release, close the active allocation and update the bed and patient states consistently. Do not free a bed while its patient assignment remains active. A released bed may move to `CLEANING` according to an explicit workflow; do not silently mark it available if cleaning is required.

## 8. 3D grid and interaction requirements

### Visual model
- Use simple stylized 3D bed models with a consistent visual scale.
- Avoid imported architectural scenes and room meshes.
- Use a clean, neutral platform or no platform at all; the background should not resemble a room.
- Use status accents on the bed/model or a nearby status marker.
- Use compact labels selectively; avoid rendering a large overlapping label over every resource at once.

### Auto-layout
- Calculate a grid layout from the number of resources, with a configurable column count or computed near-square arrangement.
- Use resource IDs to keep selection stable when filtering or sorting.
- Treat row/column/index as display coordinates only. Do not store them as physical hospital location.
- For large counts, generate visual groups (for example, 10 beds each) as a UI organization strategy. Their names must not imply physical rooms.
- Add a non-3D bed list/search path as a reliable alternative.

### Controls
- Zoom in/out and sensible min/max zoom limits
- Rotate/orbit around the inventory grid
- Reset camera
- Optional pan
- Select resource by click/tap
- Clear selected state when navigating to a different ward where appropriate
- Keep camera controls usable on desktop and touch-sized screens
- Prevent click events on a bed from accidentally triggering a camera drag

### Performance
- Use shared geometry and materials for repeated models.
- Consider instancing when it benefits performance and remains compatible with clicking individual beds.
- Avoid excessive real-time shadows, point lights, and visual effects.
- Keep the initial 100-bed view responsive. If labels or models become too dense, group or simplify the overview.

## 9. UI and accessibility

Use the supplied UI reference for styling: light blue/white palette, dark navy text, bright blue primary actions, rounded panels, soft depth, clear status chips, left navigation, resource stage, and a detail panel.

The reference is a visual guide, not a literal specification for all copy, counts, or screen layout. The actual UI must reflect real app data. Do not copy any confusing or inaccurate labels from generated image text.

Requirements:
- Responsive layout for laptop and smaller screens.
- Keyboard-accessible controls and visible focus states.
- Status text in addition to colors.
- Accessible labels for icon-only controls.
- Loading, empty, success, and error states.
- Confirmation for destructive actions and clear recovery from errors.

## 10. Security, privacy, and safety

- Use synthetic data only.
- Keep secrets in environment variables and out of frontend bundles.
- Validate and normalize input on the backend.
- Use parameterized database operations through the ORM.
- Do not expose unnecessary patient details in logs.
- If real users/auth are added, protect patient and allocation operations by role; do not imply demo mode is production-secure.
- Make clear that this hackathon prototype is not clinically validated or connected to real hospital systems.

## 11. Configuration and local run requirements

- Provide `.env.example` for required settings.
- Provide setup steps for frontend and backend.
- Provide a database initialization/migration process.
- Provide a seed/reset command for demo data.
- Document default local URLs and troubleshooting.
- Do not require cloud credentials to run the MVP locally.

## 12. Test requirements

Backend tests:
- Unique ward/bed/patient/equipment codes enforced.
- Bed generation creates the requested number of resources.
- Unsafe bed-count reduction is rejected when active allocations exist.
- Ineligible bed statuses are rejected during allocation.
- Bed-type and equipment mismatches are rejected.
- Duplicate active bed allocations are impossible.
- Duplicate active patient allocations are impossible.
- Competing allocation attempts return a conflict and leave data consistent.
- Releasing an allocation updates the allocation, patient, and bed consistently.
- Dashboard totals match the stored records.

Frontend / end-to-end checks:
- App loads and shows data-driven counts.
- Ward switching refreshes the grid.
- A 100-bed grid is generated without clipping or excessive overlap.
- Search finds a resource and selects it.
- Clicking a bed opens the correct details.
- Status updates reflect across grid, detail panel, and counts.
- Patient recommendation and confirmation complete the workflow.
- Invalid allocation shows a useful error.
- Refreshing the page preserves persisted data.

## 13. Definition of done

The MVP is done when the app runs locally from documented commands; uses persistent synthetic data; supports ward setup, a generated 100-bed view, search, selected-bed details, and a safe allocation workflow; has no architectural hospital interior; and passes the critical tests above.
