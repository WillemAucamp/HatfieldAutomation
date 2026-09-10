# Cursor Automation — Leads WhatsApp on Status change

Create this once at https://cursor.com/automations → New Automation
(or extend the existing Hatfield intake automation with the extra steps below).

## Settings

| Field | Value |
| --- | --- |
| Name | Hatfield Leads WhatsApp |
| Repository | WillemAucamp/HatfieldAutomation |
| Branch | cursor/leads-whatsapp-notify-c7fd |
| Model | cursor-grok-4.6-high-fast |
| Status | Save first, then toggle **Active** |

## Triggers

1. **Scheduled** — every 5 minutes (`*/5 * * * *`) as a safety net
2. **Webhook** — same Apps Script properties as intake:
   - `CURSOR_WEBHOOK_URL`
   - `CURSOR_WEBHOOK_API_KEY`
   Then in Apps Script run `setupLeadsWhatsAppWatch` once (after pasting the new `Code.gs`).

## Secrets (Cursor environment / .env)

| Secret | Required |
| --- | --- |
| `SHEET_WEBHOOK_URL` | yes |
| `WHATSAPP_PHONE_NUMBER_ID` | yes (Meta Cloud API) |
| `WHATSAPP_ACCESS_TOKEN` | yes |
| `WHATSAPP_APPROVE_TEMPLATE` / `WHATSAPP_DECLINE_TEMPLATE` | yes — exact approved template names |
| `WHATSAPP_TEMPLATE_LANGUAGE` | optional (default `en`) |
| `WHATSAPP_INCLUDE_NAME_PARAM` | optional — `true` if template body has `{{1}}` = name |

Outbound URL (built automatically):
`https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`

Your Render app (`https://vwwhatsappapi.onrender.com/webhook`) stays the **inbound** Meta webhook. This notifier does not POST to `/webhook`.

## Agent instructions (paste all of this)

You are the Hatfield Leads WhatsApp notifier. Do not change code. Do not open a pull request. Do not invent client data. Do not commit secrets.

Repo: WillemAucamp/HatfieldAutomation
Branch: cursor/leads-whatsapp-notify-c7fd

Each run:
1. Confirm SHEET_WEBHOOK_URL, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_ACCESS_TOKEN are present. If any is missing, stop and report the name. Do not print secret values.
2. npm ci
3. npm run doctor
4. If doctor says the Apps Script deploy is old, STOP and report that.
5. Run: npm run notify-leads -- --once
   That reads the Leads tab (gid 1730847217), finds rows where Status is Approved or Declined and "WhatsApp sent" is empty, POSTs Meta Cloud API template messages, then marks "WhatsApp sent" = Yes.
6. Reply with: scanned, pending, sent, skipped, failed. Do not print phone numbers or API keys in full.

If there is nothing to send, say so and do nothing else.
