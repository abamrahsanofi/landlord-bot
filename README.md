# Landlord Stress Firewall

Agentic landlord console for tenant maintenance: triage, draft/refine replies, advisor chat, autopilot safeguards, and a browser-based dashboard. Powered by Express + Prisma/Postgres + Vertex AI (Gemini) with MCP browser tooling for utility checks.

## Stack
- Node.js + Express + TypeScript
- Prisma ORM + Postgres
- @google-cloud/vertexai (Gemini 2.5 Pro)
- MCP browser server (optional) for web/utility tasks
- Vanilla HTML/CSS/JS dashboard (served by Express)

## Project layout
- `.github/skills/` — playbooks for RTA compliance and utility billing
- `.vscode/mcp.json` — MCP browser config
- `src/` — server entry, routes, services
- `prisma/` — schema and migrations
- `public/` — landlord dashboard (assistant + review UI)

## Prerequisites
- Node.js 18+
- Postgres reachable via `DATABASE_URL`
- Google Cloud project with Vertex AI enabled (for Gemini)
- Optional: MCP browser server if you want the web automations

## Environment
Copy `.env.example` to `.env` and set:
- `PORT` (defaults to 3000)
- `DATABASE_URL`
- `GOOGLE_PROJECT_ID`, `GOOGLE_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS` (or ADC)
- MCP-related vars if using the browser server

## Install & run locally
```bash
npm install
npx prisma migrate deploy   # or `npx prisma migrate dev` for local/dev
npm run dev                 # PORT=3000 by default
# open http://localhost:3000
```

If port 3000 is busy, start with `PORT=3001 npm run dev`.

## Dashboard primer
- Tenant chat panel: send/receive tenant messages.
- Raw triage: view severity/category, raw model output, draft text.
- Assistant console: advisor chat (analysis + “Ready reply” bubble), Apply to Draft, manual “Mark draft ready” button to unlock Send.
- Autopilot: only runs on low/normal severity; logs decisions in the journal.

## Deployment notes
- Ensure Postgres and Vertex AI credentials are available in the runtime environment.
- Run `npx prisma migrate deploy` on startup to apply migrations.
- Serve via `npm run dev` (or a prod script like `node dist/index.js` if you add a build step).

## Contributing
PRs welcome. Keep prompts/playbooks in `.github/skills` updated when changing RTA or billing logic.
