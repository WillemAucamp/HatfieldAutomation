#!/usr/bin/env bash
# Write a local .env from process env (Cloud Agent secrets) without printing values.
# Usage: ./scripts/write-local-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import os, re, secrets
from pathlib import Path

def norm(name: str, raw: str | None) -> str:
    if not raw:
        return ""
    value = raw.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1].strip()
    prefix = f"{name}="
    if value.upper().startswith(prefix.upper()):
        value = value[len(prefix):].strip()
    if name in ("SHEET_WEBHOOK_URL", "LOADED_SHEET_WEBHOOK_URL"):
        m = re.search(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec", value)
        if m:
            return m.group(0)
    return value

webhook = norm("SHEET_WEBHOOK_URL", os.environ.get("SHEET_WEBHOOK_URL"))
gemini = norm("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY"))
trigger = os.environ.get("TRIGGER_SECRET", "").strip()
if not trigger or trigger.startswith("smoke-test"):
    trigger = secrets.token_hex(32)

lines = [
    f"SHEET_WEBHOOK_URL={webhook}",
    f"GEMINI_API_KEY={gemini}",
    "SHEET_ID=12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI",
    "INTAKE_SPREADSHEET_ID=1P7J0CipLKDvPjeLWiKSxuC8ZeWSAjzhbDsQwKFwWH6M",
    "LOADED_SHEET_ID=1V8re1qmdC0AXyDKt9G3gQxcqmn3q9hAJeM_YpUkjRLM",
    "SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/12uKI418JWRhns8GQpWF1ACxlKc_zN-FcXL0NC_afMZI/export?format=csv&gid=0",
    "HEADLESS=true",
    "AUTO_LOAD=false",
    "TRIGGER_PORT=8788",
    f"TRIGGER_SECRET={trigger}",
    "TRIGGER_DATA_DIR=./data/trigger",
]
Path(".env").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("Wrote .env (gitignored)")
print(f"  SHEET_WEBHOOK_URL set: {bool(webhook)}")
print(f"  GEMINI_API_KEY set: {bool(gemini)}")
print(f"  TRIGGER_SECRET length: {len(trigger)}")
print(f"  TRIGGER_SECRET preview: {trigger[:6]}…{trigger[-4:]}")
PY
