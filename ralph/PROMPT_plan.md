## Phase 2: Planning (Ralph)

**Goal**: Update **only** `IMPLEMENTATION_PLAN.md` so it is a faithful derivation of existing acceptance criteria in `specs/**/*.md` (excluding `specs/archive/`).

### Scope Lock (Non-Negotiable)
- You may edit: `IMPLEMENTATION_PLAN.md` only.
- You may read: `specs/**/*.md` (excluding `specs/archive/`), and (optionally) repo files to confirm reality.
- Do **not** create new specs, code, tests, or docs in this phase.

### Hard Rules (Prevent Sloppy Plans)
- **No invention**: never create new acceptance criteria IDs, new PQ criteria, or new requirements.
- **No phantom references**: every AC you mention must exist verbatim in some `specs/**/*.md` file (excluding `specs/archive/`).
- **No scope creep**: do not add new feature areas/milestones that are not already in `specs/**/*.md` (excluding `specs/archive/`) and/or already reflected by the current plan.
- **No renumbering**: do not renumber or rewrite acceptance criteria in specs; only reference them.
- **No control characters**: do not output non-printable characters (e.g., `\u001f`). Use ASCII punctuation or the en dash (`–`) for ranges.
- **Ranges must be explicit**: represent ranges as `AC-x.y–AC-x.z` (en dash) or as a comma list. Never concatenate IDs.
- If you cannot find an AC you think should exist, do not guess. Record it under a "Missing/Unknown" section in the plan.

### Spec Discovery (Token Conservation)
1. Read `specs/INDEX.md` first — it lists all active specs
2. Only read specs relevant to current gaps
3. Don't load archived specs unless specifically needed

### Planning Process (Must Follow)
1. Enumerate relevant Acceptance Criteria from `specs/**/*.md` (excluding `specs/archive/`).
2. Compare those ACs to the current plan and identify gaps or incorrect mappings.
3. For each gap, add/update exactly one plan task with:
   - **Specs**: spec file path(s)
   - **Tests/backpressure**: 1–3 checks derived directly from the cited ACs
   - **Perceptual**: only if the cited specs explicitly define a perceptual AC (e.g., `AC-PQ.1`)
4. Prefer smaller, testable tasks over giant milestones.

### Task Format (Required)
Use this format for each task:

```markdown
- [ ] Task description (clear, actionable)
  - Specs: `specs/<file>.md` AC-X.Y, AC-A.B
  - Tests/backpressure:
    - Programmatic: ...
    - Programmatic: ...
  - Perceptual: AC-PQ.1 | None
```

### Output Requirement
- Produce a unified diff patch that changes `IMPLEMENTATION_PLAN.md`.
- Then print a short checklist:
  - Every referenced AC exists in specs (yes/no)
  - No new milestones introduced (yes/no)
  - No phantom AC-PQ.* introduced (yes/no)
  - No control characters introduced (yes/no)
  - Only `IMPLEMENTATION_PLAN.md` modified (yes/no)
