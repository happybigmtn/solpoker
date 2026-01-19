# Ralph

One context window. One task. Fresh each iteration.

> "Deliberate allocation in an undeterministic world."

## Philosophy

- Context windows are arrays—allocate deliberately
- One goal per iteration, then reset
- Stay in the "smart zone" (avoid context exhaustion)
- Tests provide backpressure, not optional extras
- Human ON the loop, not IN it

## Three Phases

### 1. Specs → Define WHAT (not HOW)
- `specs/*.md` — Acceptance criteria (AC-x.y format)
- Behavioral outcomes, not implementation details
- Perceptual criteria (AC-PQ.x) for subjective quality

### 2. Plan → Derive tests from ACs
- `IMPLEMENTATION_PLAN.md` — Prioritized task list
- Each task cites spec ACs and required tests
- Prompt: `PROMPT_plan.md`

### 3. Build → Implement with test backpressure
- Pick ONE unchecked task
- Implement minimal code for cited ACs
- Tests must pass before marking complete
- Prompt: `PROMPT_build.md`

## Build Rules (Non-Negotiable)

1. **Single task** — Pick exactly ONE unchecked item
2. **Spec-grounded** — Only implement cited ACs
3. **No phantom criteria** — Don't invent new ACs
4. **No drive-by refactors** — Stay focused
5. **Tests required** — All cited tests must pass
6. **Update plan** — Record learnings

## Test Output Rules

- Only show FAILING test output
- Passing tests: just "✓ N tests passed"
- Summarize if >50 lines of output

## Files

```
RALPHREADME.md          # This file (keep lean!)
IMPLEMENTATION_PLAN.md  # Current tasks
PROMPT_plan.md          # Planning prompt
PROMPT_build.md         # Building prompt
specs/*.md              # Acceptance criteria
docs/                   # Extended documentation
```

## Loop Commands

```bash
./loopclaude.sh              # Build, unlimited
./loopclaude.sh 20           # Build, max 20 iterations
./loopclaude.sh plan         # Update plan
./loopclaude.sh plan-work "scope"  # Scoped planning
```

## Completion

When all tasks done, output:
```
<promise>COMPLETE</promise>
```

---
*Full methodology: `docs/ralph-methodology.md`*
