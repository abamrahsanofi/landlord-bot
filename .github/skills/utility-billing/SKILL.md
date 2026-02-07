# Utility Billing Skill

Use this when checking utility portals to detect abnormal bills tied to maintenance issues.

1) Log into the utility portal with stored credentials (via MCP browser tool); prefer read-only actions.
2) Pull latest 3 statements; capture amount, usage, billing period.
3) Flag anomalies: >25% over prior average, sudden spikes, or late fees linked to service interruptions.
4) Export/copy relevant bill summary and usage chart data for the maintenance triage.
5) Do not change account settings; avoid triggering notifications.

Utility types to expect:
- Internet
- Water/Gas
- Hydro (electricity)

Prompting guidance (for testing):
- Provide utility type(s), username, and login URL when available.
- Request summarized anomalies and a short note suitable for the maintenance record.
