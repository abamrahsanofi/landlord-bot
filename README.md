# NestMind AI

> Multi-tenant SaaS platform for AI-powered property management — tenant communication via WhatsApp, intelligent maintenance triage with autopilot, automated utility bill fetching with LLM reasoning, Stripe billing, lease expiry alerts, contractor matching, and a browser-based landlord dashboard. Powered by Express + Prisma/PostgreSQL + Google Gemini 2.5 Flash with a full agentic tool-use framework.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Features](#features)
- [Agentic AI Framework](#agentic-ai-framework)
- [Utility Bill Fetcher (LLM Reasoning Agent)](#utility-bill-fetcher-llm-reasoning-agent)
- [WhatsApp Integration (Evolution API)](#whatsapp-integration-evolution-api)
- [Stripe Billing](#stripe-billing)
- [Dashboard](#dashboard)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Installation & Setup](#installation--setup)
- [Docker Deployment](#docker-deployment)
- [Scripts & Utilities](#scripts--utilities)
- [API Routes](#api-routes)
- [Contributing](#contributing)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────┐
│                     NestMind AI Platform                       │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐   ┌───────────────┐   ┌───────────────────┐    │
│  │ Dashboard │   │ REST API      │   │ Webhook Endpoints │    │
│  │ (HTML/JS) │   │ /api/*        │   │ /webhooks/*       │    │
│  └─────┬─────┘   └───────┬───────┘   └────────┬──────────┘    │
│        │                 │                     │               │
│  ┌─────▼─────────────────▼─────────────────────▼────────────┐ │
│  │               Express + TypeScript Server                 │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐│ │
│  │  │ Agent Framework   │  │  Service Layer                ││ │
│  │  │  • Orchestrator   │  │  • WhatsApp (Evolution API)   ││ │
│  │  │  • ReAct Loop     │  │  • Conversation Memory        ││ │
│  │  │  • Tool Registry  │  │  • Stripe Billing             ││ │
│  │  │  • 15+ Tools      │  │  • Green Button API           ││ │
│  │  │  • Plugin System  │  │  • Lease Expiry Alerts        ││ │
│  │  └────────┬──────────┘  │  • Reminder Service           ││ │
│  │           │             │  • Rate Limiter                ││ │
│  │  ┌────────▼──────────┐  │  • Encryption (AES-256)       ││ │
│  │  │ Gemini 2.5 Flash  │  │  • Media Service              ││ │
│  │  │  (Google AI)      │  └────────────────────────────────┘│ │
│  │  └───────────────────┘                                    │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │  ┌──────────────┐   ┌──────────────────────────────────┐ │ │
│  │  │ Prisma ORM   │   │ Python Bill Fetcher              │ │ │
│  │  │ PostgreSQL   │   │  • undetected-chromedriver       │ │ │
│  │  │ 13 Models    │   │  • LLM Reasoning (20 steps)     │ │ │
│  │  └──────────────┘   │  • 2FA / Account Selection      │ │ │
│  │                      │  • Anti-bot Bypass              │ │ │
│  │                      └──────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer                | Technology                                                         |
| -------------------- | ------------------------------------------------------------------ |
| **Runtime**          | Node.js 18+ (CommonJS), TypeScript, ts-node                       |
| **Web Framework**    | Express 4.x                                                       |
| **Database**         | PostgreSQL via Prisma ORM v5.21                                    |
| **AI Model**         | Google Gemini 2.5 Flash (`@google/generative-ai`)                  |
| **WhatsApp**         | Evolution API (self-hosted Docker)                                 |
| **Payments**         | Stripe (subscriptions, webhooks)                                   |
| **Browser (Node)**   | Puppeteer + puppeteer-extra-plugin-stealth                         |
| **Browser (Python)** | undetected-chromedriver + Selenium (anti-bot)                      |
| **Auth**             | JWT (bcryptjs password hashing)                                    |
| **Encryption**       | AES-256-CBC for stored credentials                                 |
| **Validation**       | Zod schema validation                                              |
| **Process**          | Docker (node:18-bookworm-slim + Chrome + Xvfb + Python 3)         |
| **Dashboard**        | Vanilla HTML/CSS/JS (served by Express)                            |

---

## Project Structure

```
nestmind-ai/
├── prisma/
│   ├── schema.prisma              # 13 models — multi-tenant SaaS schema
│   └── migrations/                # 7 incremental migrations
├── public/
│   └── dashboard.html             # Landlord dashboard (chat, triage, billing, 2FA)
├── scripts/
│   ├── fetchBill.py               # Python LLM-driven bill scraper (~2100 lines)
│   ├── addTenant.js               # CLI: add tenant to a unit
│   ├── seedSpecificTenantUnit.js  # CLI: seed tenant + unit data
│   ├── showMaintenance.js         # CLI: list maintenance requests
│   ├── showMaintenanceDetailed.js # CLI: detailed maintenance view
│   ├── test-saas.js               # Integration test: SaaS flow
│   ├── test-plugin-architecture.js# Integration test: plugin system
│   └── test-web-search.js         # Integration test: web agent
├── src/
│   ├── index.ts                   # Express server entry point (port 3000)
│   ├── config/
│   │   ├── database.ts            # Prisma client singleton
│   │   └── gemini.ts              # Gemini AI client initialization
│   ├── routes/
│   │   ├── admin.ts               # Admin dashboard API (CRUD, bill fetch, 2FA)
│   │   ├── api.ts                 # Public tenant/auth API
│   │   ├── webhooks.ts            # WhatsApp webhook receiver
│   │   ├── maintenance.js         # Maintenance request routes
│   │   └── maintenance-list.js    # Maintenance listing routes
│   └── services/
│       ├── agentFramework.ts      # ReAct loop engine (think → act → observe)
│       ├── agentOrchestrator.ts   # Multi-step agent orchestration
│       ├── agentService.ts        # Tenant message processing + autopilot
│       ├── billingService.ts      # Utility bill calculation + split logic
│       ├── conversationMemory.ts  # Persistent chat history per tenant
│       ├── encryption.ts          # AES-256-CBC encrypt/decrypt credentials
│       ├── greenButtonService.ts  # Green Button (energy data) API integration
│       ├── leaseExpiryService.ts  # Lease expiration monitoring + alerts
│       ├── mediaService.ts        # WhatsApp media handling (images, docs)
│       ├── pageReader.ts          # Web page content extraction
│       ├── planService.ts         # SaaS plan tier management (FREE/PRO/ENTERPRISE)
│       ├── rateLimiter.ts         # API rate limiting per tenant/plan
│       ├── reminderService.ts     # Scheduled persistent reminders
│       ├── repository.ts          # Data access layer (Prisma queries)
│       ├── stripeService.ts       # Stripe checkout, subscriptions, webhooks
│       ├── toolRegistry.ts        # Dynamic tool registration for agent
│       ├── verticalPlugin.ts      # Plugin architecture for vertical extensions
│       ├── webhookStatus.ts       # Webhook delivery tracking
│       ├── whatsappService.ts     # Evolution API message send/receive
│       └── tools/
│           ├── builtinTools.ts    # 15+ registered agent tools
│           └── webAgent.ts        # Puppeteer-based web browsing agent
├── docker/
│   ├── evolution-api/             # Evolution API instance data
│   └── evolution-manager/         # Nginx reverse proxy for Evolution Manager
├── docker-compose.yml             # PostgreSQL + Evolution API + Evolution Manager
├── Dockerfile                     # Production: Node 18 + Chrome + Xvfb + Python
├── package.json                   # Node.js dependencies
├── requirements.txt               # Python dependencies (bill fetcher)
├── tsconfig.json                  # TypeScript configuration
└── .env.example                   # Environment variable template
```

---

## Features

### Multi-Tenant SaaS
- **Landlord accounts** with JWT authentication and bcrypt password hashing
- **Plan tiers:** FREE (3 units), PRO (25 units), ENTERPRISE (unlimited)
- **Per-tenant isolation** — all data scoped by `landlordId`
- **Stripe subscriptions** with webhook-driven plan upgrades/downgrades
- **API rate limiting** per plan tier
- **Token & cost tracking** via `AgentUsage` model

### AI-Powered Maintenance Triage
- Incoming tenant messages automatically triaged by Gemini 2.5 Flash
- **Severity levels:** critical, high, normal, low
- **Category detection:** plumbing, electrical, HVAC, appliance, pest, structural, etc.
- **Autopilot mode:** auto-responds to low/normal severity with landlord-approved templates
- **RTA compliance:** Ontario Residential Tenancies Act knowledge baked into prompts
- **Conversation memory:** full chat history preserved for context-aware responses

### Utility Bill Management
- **Encrypted credential storage** (AES-256-CBC) for utility portal logins
- **Automated bill fetching** via Python LLM reasoning agent (see below)
- **2FA support** — dashboard modal for entering verification codes mid-session
- **Multi-account selection** from credential notes
- **Bill splitting** with configurable tenant share percentage
- **Green Button API** integration for standardized energy data

### Contractor Management
- **Contractor database** with specialties, service areas, and ratings
- **Auto-matching** to maintenance requests by category and location
- **WhatsApp integration** — contractor messages forwarded to landlords

### Communication
- **WhatsApp via Evolution API** — full two-way messaging
- **Message batching:** 5-minute intake + 1-hour cooldown (bypassed for emergencies)
- **Group chat support** with tenant participant detection
- **Media handling** — images, documents, voice messages
- **Persistent reminders** — scheduled follow-ups for tenants

### Lease Management
- **Lease expiry monitoring** with configurable alert windows
- **Automatic notifications** to landlords before lease expiration

### Plugin Architecture
- **Vertical plugins** for extending domain-specific functionality
- **Dynamic tool registration** — plugins can add new agent capabilities at runtime

---

## Agentic AI Framework

NestMind uses a full **ReAct (Reasoning + Acting)** loop powered by Gemini 2.5 Flash:

### How It Works
1. **Tenant sends a WhatsApp message** → webhook received
2. **Agent Orchestrator** loads conversation memory, tenant context, unit/lease data
3. **ReAct Loop** iterates: Think → Select Tool → Execute → Observe → Repeat
4. **Tool Registry** provides 15+ tools the agent can call via function calling
5. **Response** sent back to tenant via WhatsApp (or held for landlord approval)

### Registered Tools (builtinTools.ts)

| Tool                       | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `searchMaintenanceHistory` | Search past maintenance requests for a tenant            |
| `createMaintenanceRequest` | Create a new maintenance request with triage             |
| `updateRequestStatus`      | Update status (pending → in_progress → resolved)         |
| `getLeaseInfo`             | Retrieve lease details for a tenant's unit               |
| `getRTAGuidance`           | Ontario RTA compliance lookup                            |
| `getUtilityBills`          | Fetch stored utility bill records                        |
| `sendReminder`             | Schedule a persistent reminder                           |
| `cancelReminder`           | Cancel a scheduled reminder                              |
| `listReminders`            | List active reminders for a tenant                       |
| `getContractors`           | Search contractors by specialty/area                     |
| `assignContractor`         | Assign a contractor to a maintenance request             |
| `webSearch`                | Search the web using Puppeteer + stealth plugin          |
| `readWebPage`              | Extract content from a URL                               |
| `getWeather`               | Weather lookup for property location                     |
| `calculateBillSplit`       | Split utility bill between landlord and tenant           |

### Agent Orchestrator
- Multi-step planning with iterative refinement
- Automatic context injection (tenant info, unit details, lease status)
- Token usage tracking per request
- Graceful fallback when tools fail

---

## Utility Bill Fetcher (LLM Reasoning Agent)

`scripts/fetchBill.py` is a sophisticated Python-based browser automation agent that fetches utility bills from provider portals. It uses **undetected-chromedriver** to bypass bot detection and **Gemini 2.5 Flash** as an LLM reasoning engine for navigating complex, dynamic web portals.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│            fetchBill.py — LLM Reasoning Agent             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. LAUNCH                                               │
│     • undetected-chromedriver (anti-bot bypass)          │
│     • Chrome flags: headless optional, password popup    │
│       suppression, disable automation markers            │
│                                                          │
│  2. LOGIN PHASE                                          │
│     • 5 retry attempts with escalating strategies:       │
│       ├─ Attempt 1-3: CSS selector matching (20+         │
│       │    patterns), shadow DOM traversal via JS,       │
│       │    catch-all <input> fallback                    │
│       └─ Attempt 4-5: LLM-assisted login — Gemini       │
│            analyzes screenshot to locate login fields    │
│     • Post-submit verification: error banners,           │
│       password field still visible → bad credentials     │
│     • Post-login settle: dismiss popups, ESC key,        │
│       close buttons, SPA body-length check (>1500)       │
│                                                          │
│  3. 2FA HANDLING                                         │
│     • Detects 2FA prompts on page                        │
│     • Signals Node.js parent process via stdout JSON     │
│     • Waits for code via stdin from dashboard modal      │
│     • Re-verifies login after 2FA submission             │
│                                                          │
│  4. ACCOUNT SELECTION                                    │
│     • Parses account number from credential notes        │
│     • Scans clickable elements for matching digits       │
│     • Falls through to LLM hint if no match              │
│                                                          │
│  5. LLM REASONING LOOP (up to 20 steps)                  │
│     • Captures screenshot + page element context         │
│     • Sends to Gemini 2.5 Flash with structured prompt   │
│     • LLM returns JSON action: click/type/scroll/done    │
│     • 5-strategy click fallback chain:                   │
│       1. Index match from element list                   │
│       2. CSS selector from targetCssSelector              │
│       3. XPath text match from targetText                 │
│       4. JavaScript text search across all elements       │
│       5. Digit extraction + partial match                │
│     • Each click: human_click → JS click fallback        │
│     • 60s timeout per Gemini API call                    │
│     • Retry with exponential backoff (503/429/500)       │
│                                                          │
│  6. EXTRACTION                                           │
│     • LLM identifies bill amount, date, due date         │
│     • Returns structured JSON to stdout                  │
│     • PDF download if available                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Key Capabilities
- **Anti-bot bypass:** undetected-chromedriver patches Chrome to avoid detection
- **SPA support:** waits for dynamic content, body-length thresholds, content stabilization checks
- **Shadow DOM:** JavaScript-based input traversal for web components
- **LLM-assisted login:** Gemini analyzes screenshots when selectors fail
- **Smart credential error detection:** stops retrying on authentication failures instead of looping
- **Account hint propagation:** credential notes → account number → LLM context
- **Robust JSON parsing:** 3-tier extraction (json.loads → regex → brace-depth parser)
- **`_still_on_login` detection:** recovers if LLM navigates back to login page

### Configuration
- **Max LLM steps:** 20 (configurable via `--max-llm-steps`)
- **Gemini timeout:** 60s per API call
- **Retry policy:** 3 retries with exponential backoff (5–30s) for transient errors
- **Python process timeout:** 300s (from Node.js: 600s including overhead)
- **Temperature:** 0.2 (deterministic reasoning)
- **Max output tokens:** 2048

---

## WhatsApp Integration (Evolution API)

### Inbound Webhook
`POST /webhooks/whatsapp/evolution`

### Behavior
- Only registered tenants (or group participants who are tenants) receive replies
- Unknown numbers are silently ignored
- **Message batching:** 5-minute intake window + 1-hour cooldown per tenant
- **Emergency bypass:** critical keywords (fire, water leak, gas leak, no power/heat) skip batching
- **Group chats:** at least one participant must be a registered tenant
- **Landlord messages:** appended to latest open request, forwarded on approval
- **Contractor messages:** forwarded to landlords, no auto-reply sent

### Required Environment Variables
```
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_TOKEN=your-api-token
EVOLUTION_API_SEND_PATH=/message/sendText/{session}
EVOLUTION_API_SESSION=default
EVOLUTION_API_INSTANCE=your-instance-name
LANDLORD_WHATSAPP_NUMBERS=15551234567,15559876543
```

---

## Stripe Billing

### Plan Tiers

| Plan         | Units | Features                                    |
| ------------ | ----- | ------------------------------------------- |
| FREE         | 3     | Basic triage, manual responses              |
| PRO          | 25    | Autopilot, conversation memory, reminders   |
| ENTERPRISE   | ∞     | All features, priority support, plugins     |

### Webhook Events Handled
- `checkout.session.completed` — activate subscription
- `customer.subscription.updated` — plan change / renewal
- `customer.subscription.deleted` — downgrade to FREE
- `invoice.payment_failed` — payment failure handling

---

## Dashboard

The landlord dashboard (`public/dashboard.html`) provides:

- **Tenant chat panel** — send/receive WhatsApp messages
- **Maintenance triage view** — severity, category, raw model output, draft replies
- **AI Assistant console** — advisor chat with "Ready reply" bubbles, Apply to Draft
- **Autopilot controls** — enable/disable per unit, view decision journal
- **Utility credentials manager** — add/edit/delete portals, fetch bills
- **2FA modal** — enter verification codes during active bill fetch sessions
- **Billing & plan management** — Stripe checkout, current plan display
- **Contractor directory** — search, assign, rate contractors
- **Lease overview** — expiry dates, renewal status

---

## Database Schema

13 Prisma models supporting multi-tenant SaaS:

| Model                   | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `Landlord`              | Account, auth, plan tier, Stripe customer ID      |
| `Tenant`                | Name, phone, unit assignment                      |
| `Unit`                  | Address, lease dates, rent, linked to landlord     |
| `MaintenanceRequest`    | Triage, severity, status, autopilot tracking       |
| `UtilityBill`           | Provider, amount, period, tenant share             |
| `UtilityCredential`     | Encrypted portal login (AES-256-CBC)               |
| `Contractor`            | Specialty, area, rating, phone                     |
| `ConversationMessage`   | Persistent chat history per tenant                 |
| `Reminder`              | Scheduled follow-ups with cron-style recurrence    |
| `AgentUsage`            | Token counts, cost tracking per request            |
| `GreenButtonConnection` | Energy data API credentials                        |
| `AppSetting`            | Global configuration key-value store               |
| `LandlordSettings`      | Per-landlord preferences and overrides             |

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

### Core
```
PORT=3000
APP_PUBLIC_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/landlord?schema=public
```

### AI / LLM
```
GOOGLE_API_KEY=your-google-ai-api-key
GEMINI_API_KEY=your-gemini-api-key          # Used by Python fetchBill.py
```

### Authentication & Security
```
JWT_SECRET=your-jwt-secret-key
ENCRYPTION_KEY=your-32-byte-hex-key         # For AES-256-CBC credential encryption
```

### Stripe Billing
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
```

### WhatsApp (Evolution API)
```
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_TOKEN=your-api-token
EVOLUTION_API_TOKEN_HEADER=apikey
EVOLUTION_API_SEND_PATH=/message/sendText/{session}
EVOLUTION_API_SESSION=default
EVOLUTION_API_INSTANCE=your-instance
LANDLORD_WHATSAPP_NUMBERS=15551234567
```

### Evolution API Database (Docker)
```
EVOLUTION_POSTGRES_DATABASE=evolution
EVOLUTION_POSTGRES_USERNAME=evolution
EVOLUTION_POSTGRES_PASSWORD=change-me
```

### Utility Billing
```
UTILITY_TENANT_SHARE=0.6
```

### Optional
```
AGENTIC_MODE=true                           # Enable full agentic ReAct loop
AGENTIC_BROWSER_DEBUG=false                 # Show browser window during bill fetch
TWILIO_ACCOUNT_SID=                         # Legacy Twilio support
TWILIO_AUTH_TOKEN=
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Docker)
- Google AI API key (for Gemini 2.5 Flash)
- Python 3.10+ (for bill fetcher only)
- Google Chrome (for bill fetcher only)

### Quick Start
```bash
# 1. Install Node dependencies
npm install

# 2. Install Python dependencies (for bill fetcher)
pip install -r requirements.txt

# 3. Copy environment file
cp .env.example .env
# Edit .env with your values

# 4. Generate Prisma client
npx prisma generate

# 5. Run database migrations
npx prisma migrate deploy

# 6. Start development server
npm run dev
# → http://localhost:3000
```

### NPM Scripts
```bash
npm run dev              # Start with ts-node (development)
npm run build            # Compile TypeScript
npm start                # Run compiled JS (production)
npm run prisma:generate  # Regenerate Prisma client
npm run prisma:migrate   # Run migrations (dev mode)
npm run prisma:studio    # Open Prisma Studio GUI
npm run test:saas        # Run SaaS integration tests
npm run test:plugin      # Run plugin architecture tests
```

---

## Docker Deployment

### Docker Compose (Development)
Includes PostgreSQL, Evolution API, and Evolution Manager:
```bash
docker compose up -d
```
- PostgreSQL: `localhost:5432`
- Evolution API: `localhost:8080`
- Evolution Manager: `localhost:9615`

### Production Dockerfile
The Dockerfile builds a complete image with all dependencies:
- **Base:** node:18-bookworm-slim
- **Chrome:** google-chrome-stable (for Puppeteer + undetected-chromedriver)
- **Xvfb:** Virtual framebuffer for headless Chrome
- **Python 3:** With pip, undetected-chromedriver, selenium, google-generativeai, PyVirtualDisplay
- **dumb-init:** Proper PID 1 signal handling

```bash
docker build -t nestmind-ai .
docker run -p 3000:3000 --env-file .env nestmind-ai
```

---

## Scripts & Utilities

| Script                               | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `scripts/fetchBill.py`               | LLM-driven utility bill scraper (Python)         |
| `scripts/addTenant.js`               | Add a tenant to a specific unit                  |
| `scripts/seedSpecificTenantUnit.js`  | Seed sample tenant + unit data                   |
| `scripts/showMaintenance.js`         | List all maintenance requests                    |
| `scripts/showMaintenanceDetailed.js` | Detailed maintenance request view                |
| `scripts/test-saas.js`               | Integration test for SaaS flow                   |
| `scripts/test-plugin-architecture.js`| Integration test for plugin system               |
| `scripts/test-web-search.js`         | Integration test for web agent                   |

---

## API Routes

### Authentication (`/api`)
- `POST /api/auth/register` — Landlord registration
- `POST /api/auth/login` — JWT login
- `GET /api/auth/me` — Current user info

### Admin (`/admin`) — JWT Protected
- `GET /admin/tenants` — List tenants
- `POST /admin/tenants` — Create tenant
- `GET /admin/units` — List units
- `POST /admin/units` — Create unit
- `GET /admin/maintenance` — List maintenance requests
- `PATCH /admin/maintenance/:id` — Update request status
- `GET /admin/utilities/credentials` — List utility credentials
- `POST /admin/utilities/credentials` — Add utility credential
- `POST /admin/utilities/credentials/:id/fetch-bill` — Trigger bill fetch
- `POST /admin/utilities/credentials/:id/fetch-bill-2fa` — Submit 2FA code
- `GET /admin/bills` — List fetched bills
- `GET /admin/contractors` — List contractors
- `POST /admin/contractors` — Add contractor
- `GET /admin/usage` — Token/cost usage stats
- `POST /admin/stripe/checkout` — Create Stripe checkout session
- `GET /admin/plan` — Current plan details

### Webhooks
- `POST /webhooks/whatsapp/evolution` — Evolution API inbound messages
- `POST /webhooks/stripe` — Stripe event processing

---

## Contributing

PRs welcome. When changing core logic:
- Update Prisma schema and create a migration if touching data models
- Keep prompts/playbooks in `.github/skills/` updated for RTA or billing changes
- Run `npm run test:saas` and `npm run test:plugin` before submitting
- Follow the existing TypeScript patterns in `src/services/`

---

## License

Private — All rights reserved.
