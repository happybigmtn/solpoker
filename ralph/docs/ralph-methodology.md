# Ralph Development Methodology

A disciplined approach to AI-assisted software development using three-phase connection with test-driven backpressure.

## Philosophy

> "Deterministically bad in an undeterministic world."

Ralph operates monolithically on one task at a time, with fresh context per iteration. Plans are disposable-regenerate when wrong. Tests provide backpressure to ensure quality. The loop continues until acceptance criteria are met.

---

## Three-Phase Connection

### Phase 1: Requirements Definition

**Goal**: Define WHAT success looks like, not HOW to build it.

**Artifacts**:
- `specs/**/*.md` (excluding `specs/archive/`) — Feature specifications with acceptance criteria
- Each spec defines a coherent unit of functionality

**Process**:
1. Discuss Jobs-to-be-Done (JTBD) and break into topics of concern
2. Define acceptance criteria — observable, verifiable outcomes
3. Keep criteria behavioral (outcomes), not implementation (how to build)
4. Acceptance criteria become the foundation for test derivation in planning

**Acceptance Criteria Format**:
```markdown
## Acceptance Criteria

### AC-1: Feature Name
- **AC-1.1**: Observable outcome that can be verified
- **AC-1.2**: Another verifiable behavior
- **AC-1.3**: Performance constraint (e.g., "completes within 100ms")

### AC-2: Another Feature
- **AC-2.1**: ...

### Perceptual Quality Criteria (LLM-Validated)
- **AC-PQ.1**: Subjective quality that requires human-like judgment
- **AC-PQ.2**: Visual/UX quality that resists programmatic validation
```

---

### Phase 2: Planning

**Goal**: Derive test requirements and prioritize implementation tasks.

**Artifacts**:
- `IMPLEMENTATION_PLAN.md` — Prioritized task list with test requirements

**Process**:
1. Study specs, paying attention to acceptance criteria
2. Compare specs against existing code to find gaps
3. For each task, derive required tests from acceptance criteria
4. Identify test types needed:
   - **Programmatic**: Behavior, performance, correctness (measurable)
   - **Perceptual**: Visual quality, UX, tone (LLM-as-judge)
5. Create prioritized plan with test requirements per task

**Prompt**: `PROMPT_plan.md`

**Task Format in Plan**:
```markdown
- [ ] Implement command palette fuzzy search
  - Tests: AC-2.1 (fuzzy finds with ≤3 keystrokes), AC-2.4 (execution <100ms)
  - Perceptual: None
  
- [ ] Implement hero turn visual indicator
  - Tests: AC-1.1 (SplitBorder renders), AC-1.4 (accent color applied)
  - Perceptual: AC-PQ.1 (visual hierarchy distinguishes hero turn)
```

---

### Phase 3: Building

**Goal**: Implement functionality with tests as backpressure.

**Artifacts**:
- Source code in `src/`
- Tests (unit, integration, perceptual)
- Updated `IMPLEMENTATION_PLAN.md`

**Process**:
1. Pick most important task from plan
2. Implement tests alongside code (TDD encouraged)
3. All required tests must exist and pass before commit
4. Update plan with learnings
5. Commit and push

**Prompt**: `PROMPT_build.md`

**Critical Rules**:
- Tests are part of implementation scope, not optional
- Required tests derived from acceptance criteria must pass before commit
- Include both conventional tests and perceptual quality tests where applicable

---

## Work Branch Workflow

For focused work on a specific feature or scope:

```bash
# 1. Create work branch
git checkout -b ralph/feature-name

# 2. Create scoped plan (only tasks for this work)
./loop.sh plan-work "description of work scope"

# 3. Build from scoped plan
./loop.sh 20  # Max 20 iterations

# 4. Create PR when complete
gh pr create --base main --fill
```

**Key Principle**: Scope at plan creation, not task selection. The scoped plan contains ONLY tasks for the work branch—Ralph picks "most important" from already-scoped plan.

---

## Test Types

### Programmatic Tests
Measurable, inspectable outcomes:

```rust
#[test]
fn test_fuzzy_search_finds_command() {
    let commands = Command::search("pot");
    assert!(commands.contains(&Command::PotBet));
}

#[test]
fn test_command_execution_performance() {
    let start = Instant::now();
    execute_command(Command::Fold);
    assert!(start.elapsed() < Duration::from_millis(100));
}
```

### Perceptual Quality Tests (LLM-as-Judge)
Subjective quality that requires human-like judgment:

```rust
use crate::testing::LlmReview;

#[tokio::test]
async fn test_visual_hierarchy() {
    let screenshot = capture_tui_screenshot().await;
    let result = LlmReview::new()
        .criteria("Visual hierarchy clearly distinguishes hero turn from other states")
        .artifact_image(&screenshot)
        .review()
        .await;
    assert!(result.pass, "Failed: {}", result.feedback.unwrap_or_default());
}

#[tokio::test]
async fn test_message_tone() {
    let message = generate_welcome_message();
    let result = LlmReview::new()
        .criteria("Message uses friendly tone appropriate for casual poker players")
        .artifact_text(&message)
        .review()
        .await;
    assert!(result.pass);
}
```

**LLM Review Philosophy**: Non-deterministic reviews provide eventual consistency through iteration. Same artifact may receive different judgments—loop until pass, accepting natural variance.

---

## File Structure

```
project/
├── RALPHREADME.md          # This document
├── AGENTS.md               # Operational notes (how to run/build)
├── IMPLEMENTATION_PLAN.md  # Current plan with task list
├── ARCHIVE.md              # Completed items (when plan grows large)
├── PROMPT_plan.md          # Planning prompt
├── PROMPT_plan_work.md     # Scoped planning prompt (work branches)
├── PROMPT_build.md         # Building prompt
├── specs/ (active specs anywhere under specs/, archive in specs/archive)
│   ├── feature-one.md      # Spec with acceptance criteria
│   └── feature-two.md      # Another spec
├── src/
│   ├── ...                 # Application code
│   └── testing/
│       ├── mod.rs          # Test utilities module
│       └── llm_review.rs   # LLM-as-judge fixture
└── loop.sh                 # Automation script (optional)
```

---

## Writing Good Specs

### Structure
```markdown
# Feature Name

## Overview
Brief description of the feature and its purpose.

## Acceptance Criteria
Behavioral, observable outcomes that indicate success.
(See format above)

## Technical Details
Implementation guidance, constraints, patterns to follow.
Keep focused on WHAT, not exhaustive HOW.

## Examples
Concrete examples of expected behavior.
```

### Guidelines

1. **Acceptance criteria are behavioral**: Describe outcomes, not implementation
   - ✅ "Command palette finds commands with ≤3 keystrokes"
   - ❌ "Use sublime_fuzzy crate for search"

2. **Include performance criteria**: Make them measurable
   - ✅ "Mode transitions complete within 200ms"
   - ❌ "Mode transitions should be fast"

3. **Identify perceptual criteria**: Some quality is subjective
   - ✅ "Visual hierarchy clearly distinguishes active state"
   - These get LLM-validated tests

4. **Keep specs focused**: One coherent unit of functionality per spec

5. **Specs are living documents**: Update when implementation reveals issues

---

## Loop Script Reference

```bash
# Planning (full project)
./loop.sh plan              # Create/update IMPLEMENTATION_PLAN.md
./loop.sh plan 5            # Max 5 planning iterations

# Building
./loop.sh                   # Build, unlimited iterations
./loop.sh 20                # Build, max 20 iterations

# Work-scoped planning (on feature branch)
./loop.sh plan-work "scope" # Create scoped plan for work description
```

---

## Guardrails (from PROMPT_build.md)

Key rules enforced during building:

- **9**: Required tests from acceptance criteria must exist and pass before commit
- **99**: Create both conventional tests and perceptual quality tests
- **999**: Document the WHY in tests and implementation
- **9999**: Single sources of truth, no migrations/adapters
- **99999**: Create git tags when build/tests pass
- **9999999**: Keep IMPLEMENTATION_PLAN.md current
- **99999999**: Update AGENTS.md when learning operational details
- **9999999999**: Implement completely—no placeholders or stubs

---

## Summary

1. **Specs define WHAT** (acceptance criteria) → Tests verify WHAT works
2. **Planning derives tests** from acceptance criteria → Backpressure mechanism
3. **Building implements with tests** → All tests pass before commit
4. **Loop until done** → Fresh context, pick most important, iterate

The discipline creates a tight feedback loop where acceptance criteria flow through to tests, and tests provide backpressure ensuring implementation meets requirements.
