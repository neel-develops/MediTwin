# MediTwin — Claude Code handoff package

This package is the source of truth for building the MediTwin hackathon prototype.

## Included

- `PRD.md` — what the product must do and what is out of scope.
- `TRD.md` — recommended architecture, data model, APIs, validation, and testing requirements.
- `CLAUDE.md` — project-level rules to keep Claude Code aligned throughout development.
- `CLAUDE_CODE_PROMPTS.md` — staged prompts to paste into Claude Code in order.
- `reference/meditwin_ui_reference.png` — the **latest approved UI reference**.
- `reference/UI_REFERENCE_NOTES.md` — instructions for interpreting the image correctly.

## How to use it

1. Create or open your MediTwin project folder in Claude Code.
2. Copy these files into the project root, keeping the `reference` folder.
3. Start by pasting **Prompt 1** from `CLAUDE_CODE_PROMPTS.md`.
4. Check the app locally before moving to the next prompt. The prompts are staged so you can catch UI problems early.
5. Treat `PRD.md`, `TRD.md`, and `CLAUDE.md` as persistent requirements. Do not send the older hospital-interior concept images; they are superseded by the latest reference in this package.

## Product definition in one sentence

**MediTwin is a data-driven 3D resource inventory: the hospital configures wards and resource counts, and the app automatically generates a tidy, selectable visual grid that shows availability—not real-world bed locations or hospital architecture.**

## MVP expectations

Prioritize a working user journey: configure demo wards → view ward inventory → search/select a bed → inspect equipment and status → register a synthetic patient → get a rule-based bed recommendation → confirm allocation → see counts and visual status update.

Do not start with advanced features such as real hospital integrations, authentication providers, live multi-user sync, or clinical decision-making. Keep the app demonstrable with synthetic data.
