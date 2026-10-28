# External cron for Intake to Melrose

GitHub’s built-in `schedule` cron is **not** reliable at five-minute intervals. In practice it often fires every few hours. For steady intake processing, trigger the same workflow with **`workflow_dispatch`** from an external scheduler every **5 minutes**.

The workflow input **`scheduledTick: true`** makes each poll behave like a schedule tick: a cheap sheet probe runs first; Gemini and Seriti run only when there is pending work.

## What you need

| Item | Notes |
| --- | --- |
| GitHub PAT | **Fine-grained** or classic token with **Actions: write** on `WillemAucamp/HatfieldAutomation` |
| Scheduler | [cron-job.org](https://cron-job.org), EasyCron, your VPS `crontab`, etc. |
| Repo secrets | Unchanged: `GEMINI_API_KEY`, `SHEET_WEBHOOK_URL` on GitHub |

Store the PAT only in the scheduler’s secret store or your server env — never commit it.

## Option A — shell script (recommended)

From a machine or cron job that has `curl` and `jq`:

```bash
export GITHUB_TOKEN='ghp_…'
export SCHEDULED_TICK=true   # default in script
export MODE=full
export MAX_INTAKE_ROWS=5
/workspace/scripts/trigger-intake-workflow.sh
```

Crontab example (every 5 minutes, UTC):

```cron
*/5 * * * * GITHUB_TOKEN='…' /path/to/HatfieldAutomation/scripts/trigger-intake-workflow.sh >> /var/log/hatfield-intake-cron.log 2>&1
```

## Option B — cron-job.org (no server)

1. Create a job: every **5 minutes**.
2. Request: **POST**  
   `https://api.github.com/repos/WillemAucamp/HatfieldAutomation/actions/workflows/intake-to-melrose.yml/dispatches`
3. Headers:
   - `Accept: application/vnd.github+json`
   - `Authorization: Bearer <YOUR_PAT>`
   - `X-GitHub-Api-Version: 2022-11-28`
4. Body (JSON):

```json
{
  "ref": "main",
  "inputs": {
    "mode": "full",
    "maxIntakeRows": "5",
    "dryRun": "false",
    "scheduledTick": "true",
    "rowFilter": ""
  }
}
```

5. Expect HTTP **204** with an empty body on success.

## Forced run (ignore idle probe)

Use when you want an immediate full pipeline (e.g. new Form row just submitted):

- GitHub UI: **Run workflow** with **scheduledTick** unchecked, or
- Script: `SCHEDULED_TICK=false ./scripts/trigger-intake-workflow.sh`, or
- Sheet menu: **Hatfield → Process now** (Apps Script dispatch, idle probe off).

## GitHub schedule on `main`

The repo keeps a **daily** workflow schedule (`0 6 * * *` UTC) as a safety net if external cron stops. **Do not** rely on it for five-minute intake latency.

## Concurrency

Workflow concurrency group `hatfield-pipeline` queues overlapping runs instead of cancelling them. A slow Seriti load can delay the next tick; that is normal.

## Verify

1. After the first external trigger, open [Intake to Melrose runs](https://github.com/WillemAucamp/HatfieldAutomation/actions/workflows/intake-to-melrose.yml).
2. Event should be **workflow_dispatch** (not `schedule`).
3. Logs should show `should_run=false` and skipped Playwright on idle ticks, or a full run when Form/automation rows need work.

See also [`config/YOU_DO.md`](./YOU_DO.md).
