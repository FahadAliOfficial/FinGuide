# FinGuide

An AI-powered financial chat application with a deliberately trusted backend boundary.

> The OpenAI model understands language, selects a tool, extracts candidate inputs, and explains a verified result. It never performs the authoritative calculation.

## What the application demonstrates

- A responsive ChatGPT-style React interface with persistent, reopenable sessions
- Native OpenAI Responses API function calling without LangChain or manual prose-to-JSON extraction
- Backend-owned validation, product lookup, financial formulas, and numeric results
- Compound-interest and monthly amortized-loan calculations using Decimal.js
- Database-grounded product rates, including the seeded 6.5% `Home Loan`
- Required scope classification for every conversational turn
- Database-backed calculation totals for the current chat or all stored sessions
- Deterministic redirects for SQL, programming, cybersecurity, and other unsupported topics
- Calculation audit records with normalized inputs, formula versions, and product provenance
- Production-aware API security, structured logging, Docker packaging, CI, and automated tests

The implementation intentionally stays small enough to review in a technical interview while preserving clear production-oriented boundaries. OpenAI handles language understanding; deterministic application code owns validation, persistence, repository access, and financial truth.

## Architecture at a glance

```text
React client -> POST /api/v1/chat -> Zod HTTP validation -> ChatService
                                                             |
                                                             v
                                                  OpenAI required tool choice
                                             /             |             \
                            financial calculation  calculation summary  respond_to_user
                                     |                    |              |
                                     v                    v              v
                           Zod tool validation     Prisma aggregation  classified reply
                                     |                    |              |
                                     v                    |              |
                          product lookup/formula           |      backend-owned text
                                     |                    |              |
                                     v                    v              |
                              verified tool output -> OpenAI explanation |
                                             \                           /
                                              v                         v
                                      transactional persistence -> validated API response
```

The API follows a layered structure: HTTP concerns live in `routes` and middleware, use-case coordination in `application`, formulas and domain errors in `domain`, and OpenAI/Prisma details in `infrastructure`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for decisions, flow, threat model, and trade-offs.

### Repository layout

```text
apps/
  api/
    prisma/                 Schema, migrations, and seed
    src/
      application/          Use cases, ports, and tool dispatch
      config/               Validated environment configuration
      domain/               Pure formulas and application errors
      infrastructure/       OpenAI and Prisma adapters
      middleware/           Request IDs and safe error handling
      routes/               Versioned REST routes
  web/
    src/                    React interface, API client, and formatting
packages/
  contracts/                Shared Zod request/response contracts
docs/
  ARCHITECTURE.md           Detailed decisions, threats, and scaling path
```

Dependencies point inward: the application layer depends on repository and LLM interfaces, while `server.ts` supplies the Prisma and OpenAI implementations. Tests replace those ports with deterministic fakes.

## Local setup

Prerequisites:

- Node.js 22 or newer
- npm 10 or newer
- An OpenAI API key

Install dependencies:

```bash
npm ci
```

Create the local environment file:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS or Linux
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`, then prepare and start the application:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3000`.

The default model is `gpt-4o-mini` and can be overridden with `OPENAI_MODEL`. The API intentionally refuses to start without a key. Keep the key server-side; never expose it through a `VITE_` variable or commit the local `.env` file.

## Commands

```bash
npm run dev          # API and web app
npm run test         # unit and API integration tests
npm run typecheck    # strict TypeScript checks
npm run lint         # ESLint
npm run build        # production builds
npm run quality      # all four quality gates
npm run db:generate  # generate Prisma Client
npm run db:migrate   # apply/create development migrations
npm run db:seed      # upsert the required financial product
npm run db:studio    # inspect local data
```

## LLM orchestration and scope control

The API uses the official `openai` package and calls the Responses API directly—without LangChain, an orchestration framework, or parsing intent from free-form model prose. The default model is `gpt-4o-mini`, configurable through `OPENAI_MODEL`. Provider-side response storage is disabled (`store: false`), and bounded conversation context is loaded from the application database on every turn.

Every turn uses `tool_choice: "required"`, `parallel_tool_calls: false`, and one of four strict native functions. The tool choice itself is the intent classifier; there is no brittle keyword router and no manual parsing of model prose:

| Tool | Purpose | Backend behavior |
|---|---|---|
| `calculate_compound_interest` | Extract a complete compound-interest request | Zod validation followed by the trusted formula |
| `calculate_loan_payment` | Extract an explicit-rate or stored-product loan request | Zod validation, optional Prisma lookup, then the trusted formula |
| `get_calculation_summary` | Classify a request for calculation totals or usage | Zod validation followed by a Prisma aggregate over persisted calculation rows |
| `respond_to_user` | Classify a non-calculation turn | Returns an in-scope response or a backend-owned scope/capability message |

`respond_to_user` accepts only these categories:

```text
GREETING_OR_THANKS
CAPABILITIES
FORMULAS
SUPPORTED_EDUCATION
MISSING_PARAMETERS
OUT_OF_SCOPE
SCOPE_CHALLENGE
```

For `CAPABILITIES`, `FORMULAS`, `OUT_OF_SCOPE`, and `SCOPE_CHALLENGE`, model-written text is discarded. The backend substitutes a reviewed response, preventing an unrelated or inaccurate draft from reaching the user. Formula questions—including ambiguous follow-ups such as “What formula are you using for its calculations?”—receive both exact equations and their variable definitions. If a user points out that FinGuide answered an unsupported topic earlier, `SCOPE_CHALLENGE` acknowledges the inconsistency without reopening that topic. If OpenAI returns no function call, multiple function calls, malformed arguments, or an empty reply, the gateway fails closed.

For a completed calculation, the model's native function arguments are decoded and treated as untrusted input. The backend validates and executes them, then sends the verified result back as `function_call_output`. A second model call explains only that supplied result. The API also returns the calculation as a separate structured object, so the UI never needs to parse numeric truth from generated prose. Numeric result strings such as `"1896.20"` deliberately preserve currency precision across JSON consumers.

Calculation-history questions use the same grounded loop. For example, “How many calculations have you made total for me?” selects `get_calculation_summary` with `ALL_CONVERSATIONS`; “How many in this chat?” selects `CURRENT_CONVERSATION`. Prisma counts the stored `Calculation` rows and groups them by type. The model only explains those verified counts, and the response uses `calculation: null` because no new financial calculation was performed.

Example out-of-scope behavior:

```text
User: Can you help me with SQL injection?

FinGuide: I’m focused on compound-interest and monthly loan-payment
calculations, so I can’t help with that topic.

Try: “What will $10,000 become after 5 years at 8% annual interest?”
```

## API

### `POST /api/v1/chat`

```json
{
  "conversationId": "optional-cuid",
  "message": "Calculate the monthly payment for a $300,000 Home Loan over 30 years using the stored interest rate."
}
```

Omit `conversationId` to create a new session; include a previously returned ID to continue that session. The response contains the persisted conversation ID and assistant message. `calculation` is a backend-produced object for completed financial operations and `null` for conversational turns, missing-parameter questions, scope redirects, and calculation-summary requests. Errors use a stable `{ "error": { "code", "message", "requestId" } }` envelope.

Successful stored-rate calculations include an independently usable result:

```json
{
  "conversationId": "conversation-cuid",
  "message": {
    "id": "message-cuid",
    "role": "ASSISTANT",
    "content": "The verified monthly payment is approximately $1,896.20...",
    "createdAt": "2026-08-15T00:00:00.000Z"
  },
  "calculation": {
    "type": "LOAN_PAYMENT",
    "result": "1896.20",
    "unit": "USD",
    "inputs": {
      "principal": 300000,
      "annualRate": 6.5,
      "termYears": 30,
      "productName": "Home Loan"
    },
    "product": {
      "name": "Home Loan",
      "annualInterestRate": "6.5"
    },
    "formulaVersion": "amortized-loan-v1"
  }
}
```

If a required value is absent, the assistant asks for it and returns `calculation: null`; it does not guess. For example, “Calculate a $300,000 Home Loan using the stored rate” still requires a loan term.

### `GET /api/v1/conversations/:id/messages`

Returns persisted history for one conversation.

### `GET /api/v1/conversations?limit=20`

Returns the most recently active conversations with a generated title, latest-message preview, message count, and timestamp. The responsive history panel uses this endpoint to reopen sessions after a refresh or from another browser session using the same database.

### `GET /health`

Liveness endpoint. It does not disclose secrets or infrastructure internals.

## Database

The Prisma schema, committed migrations, and idempotent seed are in `apps/api/prisma`. SQLite keeps reviewer setup portable and requires no separate database service. A PostgreSQL migration would require changing the datasource provider and URL, generating and reviewing PostgreSQL-specific migrations, and validating production indexes and connection-pool settings; existing SQLite migration SQL should not be reused blindly. The seed creates:

| Product | Type | Annual rate |
|---|---|---:|
| Home Loan | LOAN | 6.5% |

The relational model contains `Conversation`, `Message`, `Calculation`, and `FinancialProduct`. A conversation owns ordered messages and maintains a title plus indexed last-message timestamp for efficient history listing. An assistant message may own one calculation audit row containing its type, normalized input JSON, result, unit, formula version, and optional product reference. Product deletion sets historical calculation references to null rather than deleting the audit record.

The triggering user message is committed before the external OpenAI call so an upstream failure does not erase the request. A successful assistant message and its calculation audit row are committed in one Prisma transaction. Conversation history is database-backed; local storage remembers only the currently selected conversation ID.

## Financial formulas

Compound interest, compounded `n` times per year:

```text
A = P(1 + r/n)^(nt)
```

Monthly amortized loan payment, with `i = (annualRate / 100) / 12` and `N = years * 12`:

```text
M = P * i(1 + i)^N / ((1 + i)^N - 1)
```

For compound interest, `P` is principal, `r` is the annual rate as a decimal, `n` is compounding frequency, and `t` is years. For a loan, `P` is principal, `i` is the monthly decimal rate, and `N` is the number of monthly payments. The zero-interest loan case is handled separately as `P / N`.

Inputs are bounded, terms must resolve to whole months, and calculations use Decimal.js with 40-digit working precision. Currency results are rounded half-up to two decimal places. The formula version stored beside each result makes later formula changes auditable.

## Validation, security, and failure handling

Validation is intentionally layered:

1. Shared strict Zod schemas validate HTTP requests and client-consumed API responses.
2. OpenAI strict JSON schemas constrain native tool arguments.
3. Backend Zod schemas revalidate every model-supplied value.
4. Domain functions validate normalized inputs again before arithmetic.

Runtime controls include:

- Helmet security headers and disabled `X-Powered-By`
- Explicit CORS origin, allowed methods, and headers
- Per-IP rate limiting with stable `429` responses
- 16 KB JSON body and 2,000-character message limits
- Bounded principals, rates, terms, history, and model output
- Fixed tool dispatch with no `eval`, dynamic import, or arbitrary execution
- Prisma parameterized queries and exact normalized product matching
- OpenAI timeout and retry limits
- Per-request correlation IDs returned as `X-Request-Id`
- Structured Pino logs with authorization and cookie redaction
- Safe error envelopes without stack traces
- Graceful `SIGINT`/`SIGTERM` shutdown and Prisma disconnection

An unknown stored product becomes a `404 NOT_FOUND` application error. The triggering turn and a safe assistant error are retained in conversation history, while no calculation record or explanation call is created.

## Configuration

See [.env.example](.env.example) for the complete sample configuration. Zod validates environment values at startup, including ports, URLs, numeric bounds, retry settings, history size, and log level. Important controls include an explicit CORS origin, per-IP rate limiting, OpenAI timeout/retries, and maximum conversation context.

## Docker

```bash
docker compose up --build
```

Docker is optional; the local Node.js setup above is sufficient for development. For the containerized path, create `.env` and provide `OPENAI_API_KEY` before starting Compose. The multi-stage image runs as an unprivileged user and persists SQLite under the named `data` volume. The single container serves the built web client from the API in production.

Docker Compose intentionally runs one application service rather than separate frontend, backend, and database containers:

```text
localhost:3000 -> Express API + compiled React assets
                         |
                         `-> SQLite at /data/finguide.db
                                      |
                                      `-> named data volume
```

At startup, the container applies committed Prisma migrations, runs the idempotent product seed, and then starts the compiled API. A `/health` check monitors the process.

## CI

`.github/workflows/ci.yml` installs from the lockfile, generates Prisma Client, and runs lint, type checks, tests, and production builds.

Latest verified quality baseline:

| Gate | Result |
|---|---:|
| ESLint | Passed |
| Strict TypeScript | Passed |
| API tests | 28 passed |
| Web tests | 5 passed |
| Total tests | 33 passed |
| API production build | Passed |
| Web production build | Passed |

Tests cover formulas, numeric bounds, zero-interest loans, stored product grounding, unknown products, conflicting rate sources, native OpenAI tool orchestration, calculation-summary intent and persistence, formula-question routing, contextual scope challenges, fail-closed behavior, SQL-scope leakage, HTTP validation/security headers, conversation persistence, assistant formatting, and UI session restoration.

## Assumptions and limitations

- FinGuide is an educational estimation tool, not financial advice.
- USD is the only supported currency because the assignment examples use dollars. Currency conversion and locale-specific formatting are not implemented.
- Rates are interpreted as nominal annual percentage rates. Loan terms must resolve to a whole number of months.
- Monthly-loan estimates use a fixed-rate amortization formula. They exclude fees, taxes, insurance, variable rates, balloon payments, early repayments, and lender-specific rules.
- Compound-interest calculations assume a fixed principal and rate. Recurring deposits, withdrawals, taxes, and changing rates are excluded. Annual compounding is used only when frequency is omitted, and the response states that assumption.
- Product names use normalized, case-insensitive exact matching. Fuzzy search and semantic product discovery are intentionally excluded.
- Supported functionality is limited to compound interest, monthly loan payments, explanations of those formulas, and database-backed calculation totals. Missing inputs are requested rather than guessed; unrelated requests receive a deterministic scope redirect.
- Authentication and multi-user authorization are outside the assignment scope. `ALL_CONVERSATIONS` therefore means every calculation stored by this single-user application, not records owned by an authenticated person.
- CUID conversation identifiers reduce accidental guessing but are not an authorization mechanism. A multi-user deployment must enforce authenticated ownership on every read and write.
- Conversation content is stored in the application database without field-level encryption, retention policies, export, or deletion workflows.
- SQLite is suitable for portable assessment setup, not horizontally scaled writes. Production should use PostgreSQL, reviewed migrations, backups, and managed connection pooling.
- Rate limiting is process-local, and `trust proxy` assumes one trusted reverse-proxy hop. A replicated deployment needs topology-specific proxy configuration and Redis-backed distributed limiting.
- Chat writes do not currently use idempotency keys. A client or infrastructure retry could therefore create duplicate messages or calculations.
- OpenAI introduces external latency, availability, cost, and nondeterministic prose. Backend formulas and validations remain deterministic, and live model calls are excluded from CI in favor of mocked orchestration tests.
- Responses are non-streaming and there is no model-provider fallback. This keeps persistence and failure handling small for the assignment but may increase perceived latency during provider delays.
- A production deployment would additionally require managed secrets, TLS termination, authenticated users, database backups, centralized telemetry, alerting, and formal data-retention controls.

## AI-assisted development disclosure

AI assistance was used to accelerate scaffolding, test design, documentation, and review, as permitted by the assignment. The submitter remains responsible for the architecture and final code. Every trust-boundary decision, formula, validation rule, database write, and error path is represented in deterministic code and tests and should be understood well enough to explain or modify during the technical discussion.
