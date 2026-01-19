## Phase 2: Scoped Planning (Work Branch)

**Goal**: Update **only** `IMPLEMENTATION_PLAN.md` to include ONLY tasks relevant to the provided work scope, and ensure every task is grounded in existing `specs/**/*.md` acceptance criteria (excluding `specs/archive/`).

### Scope Lock (Non-Negotiable)
- You may edit: `IMPLEMENTATION_PLAN.md` only.
- You may read: `specs/**/*.md` (excluding `specs/archive/`), and any repo files needed to confirm reality.
- Do **not** create new specs, code, tests, or docs in this phase.

### Hard Rules (Prevent Sloppy Scoped Plans)
- **Scope discipline**: include ONLY tasks that directly serve the work scope header provided by the script.
- **No invention**: never create new acceptance criteria IDs, new PQ criteria, or new requirements.
- **No phantom references**: every AC you mention must exist verbatim in some `specs/**/*.md` file (excluding `specs/archive/`).
- **No renumbering**: don’t renumber or rewrite ACs from specs.
- **No spec creation**: if a needed spec/AC is missing, record it as a blocker in `IMPLEMENTATION_PLAN.md` under "Missing/Unknown" instead of creating files.

### Scoped Planning Process (Must Follow)
1. Identify which existing `specs/**/*.md` (excluding `specs/archive/`) files and ACs apply to the work scope.
2. Compare those ACs to the current `IMPLEMENTATION_PLAN.md` and find gaps *within scope*.
3. Add/update tasks for the scope only, each with:
   - `Specs: specs/<file>.md` AC-X.Y
   - 1–3 concrete tests/backpressure items derived directly from those ACs
   - Perceptual: only if the specs explicitly define it (e.g., `AC-PQ.1`)

### Task Format (Required)

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
  - All tasks are strictly within provided work scope (yes/no)
  - Every referenced AC exists in specs (yes/no)
  - Only `IMPLEMENTATION_PLAN.md` modified (yes/no)
