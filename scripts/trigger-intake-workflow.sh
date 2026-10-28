#!/usr/bin/env bash
# Trigger GitHub Actions "Intake to Melrose" via workflow_dispatch.
# Use from cron-job.org, a VPS crontab, or locally when you need reliable ~5 min polling.
#
# Required: GITHUB_TOKEN — PAT with repo scope and Actions: write (fine-grained: Actions R/W on this repo).
# Optional: GITHUB_REPO, GITHUB_REF, MODE, MAX_INTAKE_ROWS, SCHEDULED_TICK, ROW_FILTER.
#
# SCHEDULED_TICK=true (default) skips Playwright/Gemini when sheets are idle — same as the workflow schedule probe.
# Set SCHEDULED_TICK=false for a forced full run (same as Hatfield → Process now).

set -euo pipefail

GITHUB_TOKEN="${GITHUB_TOKEN:?Set GITHUB_TOKEN to a GitHub PAT with Actions write}"
GITHUB_REPO="${GITHUB_REPO:-WillemAucamp/HatfieldAutomation}"
GITHUB_REF="${GITHUB_REF:-main}"
MODE="${MODE:-full}"
MAX_INTAKE_ROWS="${MAX_INTAKE_ROWS:-5}"
SCHEDULED_TICK="${SCHEDULED_TICK:-true}"
ROW_FILTER="${ROW_FILTER:-}"
DRY_RUN="${DRY_RUN:-false}"

payload="$(jq -n \
  --arg ref "$GITHUB_REF" \
  --arg mode "$MODE" \
  --arg max "$MAX_INTAKE_ROWS" \
  --arg tick "$SCHEDULED_TICK" \
  --arg filter "$ROW_FILTER" \
  --arg dry "$DRY_RUN" \
  '{
    ref: $ref,
    inputs: {
      mode: $mode,
      maxIntakeRows: $max,
      dryRun: $dry,
      scheduledTick: $tick,
      rowFilter: $filter
    }
  }')"

curl -sfS -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/intake-to-melrose.yml/dispatches" \
  -d "$payload"

echo "Dispatched Intake to Melrose on ${GITHUB_REPO}@${GITHUB_REF} (mode=${MODE}, scheduledTick=${SCHEDULED_TICK})"
