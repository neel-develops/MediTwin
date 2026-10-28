# MediTwin — Product Requirements Document (PRD)

**Version:** 1.0  
**Purpose:** Hackathon software prototype  
**Product tagline:** Smarter Hospital Resource Allocation

## 1. Product summary

MediTwin is a hospital resource inventory and allocation application with a stylized 3D interface. It lets a hospital configure wards and the resources assigned to them, then automatically creates an organized visual grid of beds and equipment. Staff can quickly see availability, inspect an individual resource, search by ID, and review suitable bed recommendations for a synthetic patient.

MediTwin is **not** an architectural digital twin or a realistic hospital walkthrough. It does not map a bed to a physical corner, room, wall, or coordinate. The 3D arrangement exists only to make inventory easier to scan and interact with.

## 2. Problem

Staff may need to check several wards or separate lists to understand how many beds are available, which resources are reserved or unavailable, and whether required equipment is ready. During a surge, this makes resource discovery and allocation harder.

MediTwin centralizes the resource data in one view and makes availability visible and searchable.

## 3. Product principles

1. **Inventory, not interiors:** show resources, not hospital architecture.
2. **Data drives the view:** counts, statuses, labels, and panels must be derived from application data.
3. **Every visual resource is selectable:** selecting a bed opens its details and valid actions.
4. **Scales by grouping:** 100 beds should look organized, not crowded. Grouping is a visual convenience only.
5. **Explain recommendations:** show why a bed qualifies or why it was rejected.
6. **Staff stays in control:** the system recommends; an authorized user confirms.
7. **Demo safely:** use fictional patients and clearly identify simulated data.

## 4. Target users

- **Hospital administrator:** configures wards and resource inventory and reviews overall availability.
- **Ward staff / allocation staff:** checks availability, finds resources, and processes patient allocations.
- **Hackathon demonstrator:** explores the prototype using synthetic data.

The first prototype may use a simple demo role. Role-based permissions can be represented in the UI but full production-grade identity management is not required for the MVP.

## 5. Goals

- Show total, available, occupied, reserved, cleaning, and maintenance counts clearly.
- Let a user switch among configurable wards such as Ward 1, Ward 2, ICU, Pediatrics, and Maternity.
- Generate a neat grid of 3D bed models from a configured bed count.
- Support at least 100 beds in a ward and fast lookup of a specific bed.
- Let authorized demo users view and update resource status using valid transitions.
- Register synthetic patients and recommend suitable beds based on explicit rules.
- Keep dashboard totals, the 3D view, details panels, and search results consistent.

## 6. Non-goals / explicitly out of scope

- Realistic hospital walls, corridors, doors, windows, waiting rooms, chairs, plants, reception areas, or room decoration.
- Exact physical bed placement, physical navigation, indoor positioning, or room-corner coordinates.
- Architectural floor plans or first-person walkthroughs.
- Real patient data, electronic health record integrations, medical-device integrations, or claims of clinical certification.
- AI-based diagnosis, medical triage, or autonomous clinical decisions.
- Complex live multi-hospital operations in the initial MVP.

## 7. Information architecture

Primary navigation:

- Dashboard
- 3D Explorer
- Patients
- Beds & Resources
- Equipment
- Alerts
- Reports
- Setup / Settings

Resource navigation is data-led:

**Hospital → Ward → optional visual group → resource detail**

Wards are created or configured by the hospital. Visual groups such as “Section A” or “Group 1” may be generated automatically to keep a large grid manageable. They do not represent real rooms or physical areas, and the UI should not imply otherwise. Floors are optional metadata only; do not require a floor hierarchy for the MVP.

## 8. Core screens and requirements

### 8.1 Dashboard

Display data-derived summary cards:
- Total beds
- Available beds
- Occupied beds
- Reserved beds
- Cleaning beds
- Maintenance beds
- Equipment available / in use / under maintenance

Also show ward summaries, recent activity, and current alerts. Any charts and counters must derive from the same stored records as the explorer.

### 8.2 Initial setup / ward configuration

An administrator can create, edit, or deactivate a ward. Each ward has:
- Ward name (e.g., Ward 1, Ward 2, General Ward, ICU)
- Optional ward category/type
- Configured bed count, either by creating individual beds or generating them in bulk
- Optional bed-type distribution (e.g., General Bed, ICU Bed)
- Optional equipment inventory

The app generates unique IDs for generated resources. Example: `W1-001` through `W1-100`. Users can change the prefix or naming scheme if practical.

Changing the configured count must be safe: never silently delete a bed that has a patient or active allocation. Explain conflicts and require the user to resolve them first.

### 8.3 3D resource explorer

The 3D stage should display simplified, stylized beds in a regular, readable grid or grouped grids. Use a soft blue/white interface with clear status color accents, consistent with `reference/meditwin_ui_reference.png`.

Required behavior:
- Choose a ward from the ward selector or sidebar.
- Show total resource count and status breakdown.
- Generate one selectable model per bed, based on stored data.
- Use an orderly auto-layout independent of physical hospital geometry.
- Support zoom, rotate, reset-view, and optional pan.
- Highlight a selected resource and open its detail panel.
- Allow filtering by state and bed type.
- Allow search by bed ID.
- Offer a list/grid alternative for users who prefer fast lookup or cannot use 3D.
- When the selected ward has many resources, group them into clearly labeled visual groups and allow opening a group. Grouping is not a physical location.

### 8.4 Resource states

Bed statuses:
- `AVAILABLE`
- `OCCUPIED`
- `RESERVED`
- `CLEANING`
- `MAINTENANCE`

Suggested colors:
- Available: green/teal
- Occupied: coral/red
- Reserved: amber
- Cleaning: slate blue/grey
- Maintenance: violet or dark grey

Always show a text label or accessible status indicator; color alone is insufficient. State and color meanings must remain consistent on every screen.

### 8.5 Bed details

Clicking a bed opens a panel containing:
- Bed ID
- Ward name
- Bed type
- Current status
- Required / associated equipment
- Patient assignment if one exists
- Last-updated timestamp where available
- Available actions appropriate to its current state

Example: `W1-059 · Ward 1 · General Bed · Available · Monitor and oxygen outlet · No patient assigned`.

Buttons must perform real actions. Do not show actions that cannot succeed in the current state. Any action that changes data should provide success or error feedback.

### 8.6 Patient management

Support:
- Patient list and search
- Create a synthetic/demo patient
- Fields: patient code, display name, care category, required bed type, required equipment types, status
- View current assignment
- Start a bed search / recommendation workflow
- Confirm an allocation after review
- Release an allocation for discharge or transfer

Use fictional names and IDs. Label seed data as demo data.

### 8.7 Rule-based bed recommendations

Recommendations should be transparent, deterministic, and configurable. The MVP can use rules, not machine learning.

Minimum constraints:
- The bed must be available.
- The bed type must match the requested type or an explicitly configured compatible type.
- Required equipment must be available and compatible with the proposed assignment.
- Any configured special requirement must be met.
- A resource already allocated elsewhere must not be recommended as available.

Show recommended beds with a short explanation of matches and any unmet requirements. A score or ranking is optional and must not imply clinical certainty. If no bed qualifies, clearly say no suitable bed was found and show the missing requirements where possible.

An authorized user must review and confirm the recommendation. This prototype must not make medical judgments or autonomously triage patients.

### 8.8 Equipment inventory

Track example equipment types such as monitors, ventilators, infusion pumps, oxygen equipment, and wheelchairs. Each item has an ID, type, status, optional associated bed or ward, and relevant notes. Do not represent equipment's physical coordinate as meaningful.

Prevent double-allocation of a single-unit equipment item. Quantity-based inventory may be supported where appropriate (e.g., 12 monitors available) but must not be mixed up with individually tracked devices.

### 8.9 Search and filters

Global search should locate a ward, bed ID, or equipment ID. Filters should include ward, resource status, resource type, and bed type where relevant. Selecting a result should open the correct detail panel and highlight the matching resource in the explorer when it is a bed.

### 8.10 Alerts and activity

Show actionable alerts such as:
- Low available-bed count
- Equipment shortage
- Resource in maintenance
- An allocation conflict
- High occupancy by configured threshold

Thresholds must be configurable or clearly set as demo defaults. Activity history should record important mutations such as allocation, release, status changes, and inventory changes.

### 8.11 Reports / simulation — stretch goals

After the MVP works:
- Occupancy by ward
- Equipment utilization summary
- Recent allocation history
- Simulated sudden increase in demand

Simulation must be clearly marked as simulated and must not be presented as live hospital data.

## 9. Key user journey

1. Admin opens Setup and creates Ward 1 with 100 beds and Ward 2 with 40 beds.
2. MediTwin generates unique bed IDs and displays an auto-arranged 3D grid.
3. Staff opens Ward 1 and sees total counts and bed statuses.
4. Staff searches for or selects a specific bed and reviews its details.
5. Staff registers a fictional patient with care-category, bed-type, and equipment requirements.
6. MediTwin lists suitable available beds and explains why each qualifies.
7. Staff selects a bed and confirms the allocation.
8. The backend validates the request and saves it safely.
9. The patient, bed state, dashboard counts, and explorer update consistently.
10. The activity history records the change.

## 10. Acceptance criteria

The MVP is acceptable when:
- An administrator can configure wards and bulk-generate a requested number of beds.
- A ward with 100 beds renders as a clean, automatically arranged visual inventory without architecture.
- The arrangement does not claim to represent physical positions.
- The user can search for any bed ID and select a bed.
- The selected bed's details match stored data.
- Status summaries are correctly calculated and updated following successful actions.
- An occupied, reserved, cleaning, or maintenance bed cannot be assigned as available.
- A bed type or equipment mismatch is rejected by the backend.
- Two competing allocations cannot allocate the same bed.
- Patient allocation and release update all relevant records consistently.
- Data persists through page refresh and app restart in local development.
- Loading, empty, and error states are handled.
- The complete demo journey works with synthetic data and without physical hardware.

## 11. Priorities

**P0 — MVP:** data-driven dashboard; ward setup; auto-generated beds; 3D grid; selection and details; search and filters; status actions; synthetic patient creation; rule-based recommendations; safe allocation/release; persistent database; seed data; README setup instructions.

**P1 — after MVP:** individually tracked equipment workflows; reports; alert thresholds; simulated demand surge; activity log UI; responsive refinements; stronger role permissions.

**P2 — future:** real authentication, multiple hospital tenants, real-time multi-user synchronization, integrations with hospital systems, production-grade security and compliance.
