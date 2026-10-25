#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 ]]; then
  echo 'Usage: bash run.sh SOURCE_ROOT OUTPUT_ROOT' >&2
  exit 2
fi
source_root=$(realpath "$1")
output_root=$(realpath -m "$2")
script_root=$(cd "$(dirname "$0")" && pwd)
if [[ -e "$output_root" ]]; then
  echo "Output directory must be new: $output_root" >&2
  exit 2
fi
mkdir -p "$output_root"
{
  echo "node $script_root/repro.mjs SOURCE_ROOT OUTPUT_ROOT/normal normal"
  echo "node $script_root/repro.mjs SOURCE_ROOT OUTPUT_ROOT/interrupted interrupt"
  echo "sleep 2"
  echo "node $script_root/repro.mjs SOURCE_ROOT OUTPUT_ROOT/interrupted recover"
} > "$output_root/commands.txt"
sha256sum "$script_root/repro.mjs" "$script_root/run.sh" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs" \
  "$source_root/openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor.mjs" \
  "$source_root/openclaw/codex-evaluator/program-recovery-fixture.mjs" > "$output_root/hashes.txt"
node "$script_root/repro.mjs" "$source_root" "$output_root/normal" normal \
  > "$output_root/normal.stdout.log" 2> "$output_root/normal.stderr.log"
set +e
node "$script_root/repro.mjs" "$source_root" "$output_root/interrupted" interrupt \
  > "$output_root/interrupt.stdout.log" 2> "$output_root/interrupt.stderr.log"
interrupt_status=$?
set -e
echo "$interrupt_status" > "$output_root/interrupt.exit-code.txt"
if [[ "$interrupt_status" != 137 ]]; then
  echo "Expected actual SIGKILL exit 137, got $interrupt_status" >&2
  exit 1
fi
stage="$output_root/interrupted/checkpoint/WI-fixture-program-recovery/initial/EVALUATE_JOBAID"
cp "$stage/jobaid-run-budget.json" "$output_root/budget.before-recovery.json"
cp "$output_root/interrupted/synthetic-state.json" "$output_root/state.before-recovery.json"
sleep 2
node "$script_root/repro.mjs" "$source_root" "$output_root/interrupted" recover \
  > "$output_root/recover.stdout.log" 2> "$output_root/recover.stderr.log"
cp "$stage/jobaid-run-budget.json" "$output_root/budget.after-recovery.json"
cp "$output_root/interrupted/synthetic-state.json" "$output_root/state.after-recovery.json"
cmp "$output_root/budget.before-recovery.json" "$output_root/budget.after-recovery.json"
echo 'budget checkpoint bytes unchanged across recovery' > "$output_root/budget-comparison.txt"
