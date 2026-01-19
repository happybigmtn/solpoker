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

_Full methodology: `docs/ralph-methodology.md`_

When asked to BreakdownSprints:
If you were to break this project down into sprints and tasks, how would you do it (timeline info does not need to be included and doesn't matter) - every task/ticket should be an atomic, committable piece of work with tests (and if tests don't make sense, another form of validation that it was completed successfully). Every sprint should result in a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive, be clear, be technical, always focus on small atomic tasks that compose up into a clear goal for the sprint. Once you're done, provide this prompt to a subagent to review your work and suggest improvements. When you're done reviewing the suggested improvements, write your tasks/tickets, sprint plans, etc., to a markdown file (store under `ralph/specs/`, e.g., `ralph/specs/sprint-plan.md`), then implement those specs into `IMPLEMENTATION_PLAN.md`, following the guidance in this file.
