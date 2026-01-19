#!/bin/bash
# Ralph loop runner (canonical script).
# Usage: ./loopclaude.sh [mode] [max_iterations]
# Examples:
#   ./loopclaude.sh                        # Build mode, unlimited iterations
#   ./loopclaude.sh 20                     # Build mode, max 20 iterations
#   ./loopclaude.sh plan                   # Plan mode, unlimited iterations
#   ./loopclaude.sh plan 5                 # Plan mode, max 5 iterations
#   ./loopclaude.sh plan-work "scope"      # Scoped planning for work branch
#   ./loopclaude.sh plan-work "scope" 3    # Scoped planning, max 3 iterations
#
# Note: ./loop.sh is a thin wrapper for docs parity.

# Colors for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# Filter function to extract readable output from stream-json
filter_output() {
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue

        # Validate JSON before parsing
        if ! echo "$line" | jq -e . >/dev/null 2>&1; then
            continue
        fi

        type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
        subtype=$(echo "$line" | jq -r '.subtype // empty' 2>/dev/null)

        case "$type" in
            "system")
                case "$subtype" in
                    "init")
                        echo -e "${DIM}Session initialized${NC}"
                        ;;
                esac
                ;;
            "assistant")
                # Show tool uses with details
                tool_name=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .name // empty' 2>/dev/null | head -1)
                if [[ -n "$tool_name" ]]; then
                    case "$tool_name" in
                        "Read")
                            file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
                             echo -e "${DIM}Reading${NC} $file"
                             ;;
                         "Write")
                             file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
                             echo -e "${GREEN}Writing${NC} $file"
                             ;;
                         "Edit"|"MultiEdit")
                             file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
                             echo -e "${GREEN}Editing${NC} $file"
                             ;;
                         "Bash")
                             desc=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.description // empty' 2>/dev/null | head -c 50)
                             [[ -z "$desc" ]] && desc=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.command // empty' 2>/dev/null | head -c 50)
                             echo -e "${YELLOW}Running${NC} ${DIM}${desc}${NC}"
                             ;;
                         "Grep"|"Glob")
                             pattern=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.pattern // empty' 2>/dev/null | head -c 30)
                             echo -e "${DIM}Searching${NC} $pattern"
                             ;;
                         "TodoWrite")
                             echo -e "${CYAN}Updating todos${NC}"
                             ;;
                         "Task")
                             task_desc=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.description // empty' 2>/dev/null | head -c 50)
                             echo -e "${CYAN}Agent${NC} ${DIM}${task_desc}${NC}"
                             ;;
                         *)
                             echo -e "${DIM}${tool_name}${NC}"
                             ;;
                     esac
                 else
                     # Show assistant text (first 120 chars)
                     text=$(echo "$line" | jq -r '.message.content[]? | select(.type=="text") | .text // empty' 2>/dev/null | tr '\n' ' ' | head -c 120)
                     if [[ -n "$text" ]]; then
                         echo -e "${CYAN}>${NC} ${text}..."
                     fi
                 fi
                ;;
            "result")
                if [[ "$subtype" == "success" ]]; then
                    cost=$(echo "$line" | jq -r '.total_cost_usd // empty' 2>/dev/null)
                    if [[ -n "$cost" ]]; then
                        echo -e "${GREEN}Completed${NC} ${DIM}(\$${cost})${NC}"
                    fi
                fi
                ;;
            "error")
                msg=$(echo "$line" | jq -r '.error.message // .message // empty' 2>/dev/null | head -c 200)
                [[ -n "$msg" ]] && echo -e "${RED}Error: ${msg}${NC}"
                ;;
        esac
    done
}

# Parse arguments
WORK_SCOPE=""
if [ "$1" = "plan" ]; then
    # Plan mode
    MODE="plan"
    PROMPT_FILE="PROMPT_plan.md"
    MAX_ITERATIONS=${2:-0}
elif [ "$1" = "plan-work" ]; then
    # Scoped plan mode for work branches
    MODE="plan-work"
    PROMPT_FILE="PROMPT_plan_work.md"
    WORK_SCOPE="$2"
    MAX_ITERATIONS=${3:-0}
    if [ -z "$WORK_SCOPE" ]; then
        echo -e "${RED}Error: plan-work requires a scope description${NC}"
        echo -e "${DIM}Usage: ./loop.sh plan-work \"description of work scope\"${NC}"
        exit 1
    fi
elif [[ "$1" =~ ^[0-9]+$ ]]; then
    # Build mode with max iterations
    MODE="build"
    PROMPT_FILE="PROMPT_build.md"
    MAX_ITERATIONS=$1
else
    # Build mode, unlimited (no arguments or invalid input)
    MODE="build"
    PROMPT_FILE="PROMPT_build.md"
    MAX_ITERATIONS=0
fi

ITERATION=0
TOTAL_COST=0
CURRENT_BRANCH=$(git branch --show-current)

# Temp file for raw output (for completion detection)
RAWFILE=$(mktemp)
trap "rm -f $RAWFILE" EXIT

echo -e "${BOLD}Starting Ralph${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Mode:   ${CYAN}$MODE${NC}"
echo -e "Prompt: ${DIM}$PROMPT_FILE${NC}"
echo -e "Branch: ${GREEN}$CURRENT_BRANCH${NC}"
[ -n "$WORK_SCOPE" ] && echo -e "Scope:  ${YELLOW}$WORK_SCOPE${NC}"
[ $MAX_ITERATIONS -gt 0 ] && echo -e "Max:    ${YELLOW}$MAX_ITERATIONS iterations${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo -e "${RED}Error: $PROMPT_FILE not found${NC}"
    exit 1
fi

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo -e "${YELLOW}Reached max iterations: $MAX_ITERATIONS${NC}"
        break
    fi

    # Run Ralph iteration with selected prompt
    # -p: Headless mode (non-interactive, reads from stdin)
    # --dangerously-skip-permissions: Auto-approve all tool calls (YOLO mode)
    # --output-format=stream-json: Structured output for logging/monitoring
    # --model opus: Primary agent uses Opus for complex reasoning (task selection, prioritization)
    #               Can use 'sonnet' in build mode for speed if plan is clear and tasks well-defined
    # --verbose: Detailed execution logging
    if [ -n "$WORK_SCOPE" ]; then
        # Prepend scope to plan-work prompt
        { echo "## Work Scope: $WORK_SCOPE"; echo ""; cat "$PROMPT_FILE"; } | claude -p \
            --dangerously-skip-permissions \
            --output-format=stream-json \
            --model opus \
            --verbose 2>&1 | tee "$RAWFILE" | filter_output
    else
        cat "$PROMPT_FILE" | claude -p \
            --dangerously-skip-permissions \
            --output-format=stream-json \
            --model opus \
            --verbose 2>&1 | tee "$RAWFILE" | filter_output
    fi

    # Track cumulative cost
    iteration_cost=$(grep -o '"total_cost_usd":[0-9.]*' "$RAWFILE" 2>/dev/null | tail -1 | cut -d: -f2)
    if [ -n "$iteration_cost" ]; then
        TOTAL_COST=$(echo "$TOTAL_COST + $iteration_cost" | bc 2>/dev/null || echo "$TOTAL_COST")
        echo -e "${DIM}💰 Session cost: \$${TOTAL_COST}${NC}"
    fi

    # Check for completion signal
    if grep -qE '<promise>COMPLETE</promise>|all tasks complete|plan complete' "$RAWFILE" 2>/dev/null; then
        echo -e "${GREEN}✅ All tasks complete!${NC}"
        break
    fi

    # Optional: checkpoint commit/push (opt-in).
    # Default behavior is no commits/pushes.
    if [ "${RALPH_AUTOCOMMIT:-0}" = "1" ] && [ "$MODE" = "build" ]; then
        # Create a checkpoint commit if there are any changes (including untracked).
        if [ -n "$(git status --porcelain)" ]; then
            ts=$(date +"%Y-%m-%d %H:%M:%S")
            msg="loop: iteration $((ITERATION + 1)) @ $ts"
            echo -e "${DIM}Committing checkpoint: ${msg}${NC}"
            git add -A
            git commit -m "$msg" 2>&1 | head -5 || {
                echo -e "${YELLOW}Commit failed; leaving changes uncommitted${NC}"
            }
        else
            echo -e "${DIM}No changes to commit${NC}"
        fi

        echo -e "${DIM}Pushing to origin/$CURRENT_BRANCH...${NC}"
        git push origin "$CURRENT_BRANCH" 2>&1 | head -3 || {
            echo -e "${YELLOW}Creating remote branch...${NC}"
            git push -u origin "$CURRENT_BRANCH" 2>&1 | head -3
        }
    else
        echo -e "${DIM}Skipping commit/push (set RALPH_AUTOCOMMIT=1 to enable)${NC}"
    fi

    ITERATION=$((ITERATION + 1))
    echo ""
    echo -e "${BOLD}${CYAN}======================= LOOP $ITERATION =======================${NC}"
    echo ""
done
