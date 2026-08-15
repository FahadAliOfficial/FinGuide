# FinGuide

AI-assisted financial calculations with a deliberately trusted backend boundary.

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

## Quick start

Prerequisites: Node.js 22+ and an OpenAI API key.

```bash
npm install
copy .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3000`.

Set `OPENAI_API_KEY` in `.env`. The default model can be overridden with `OPENAI_MODEL`. Keep the key server-side; never expose it through a `VITE_` variable.

## Commands

```bash
npm run dev          # API and web app
npm run test         # unit and API integration tests
npm run typecheck    # strict TypeScript checks
npm run lint         # ESLint
npm run build        # production builds
npm run quality      # all four quality gates
npm run db:studio    # inspect local data
```

## LLM orchestration and scope control

The API uses the official `openai` package and calls the Responses API directly. The default model is `gpt-4o-mini`, configurable through `OPENAI_MODEL`. Provider-side response storage is disabled, and conversation context is loaded from SQLite with a configurable maximum length.

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

For a completed calculation, the model's native function arguments are decoded and treated as untrusted input. The backend validates and executes them, then sends the verified result back as `function_call_output`. A second model call explains only that supplied result. The API also returns the calculation as a separate structured object, so the UI never needs to parse numeric truth from generated prose.

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

The response contains the persisted conversation ID and assistant message. `calculation` is a backend-produced object for completed financial operations and `null` for conversational turns such as greetings, capability questions, out-of-scope redirects, or requests for missing parameters. Every turn uses strict native tool selection. Capability and out-of-scope text is backend-owned, so unrelated model-written content cannot reach the user. Errors use a stable `{ "error": { "code", "message", "requestId" } }` envelope.

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

Prisma schema and migration are in `apps/api/prisma`. SQLite makes reviewer setup one command; changing `provider` and `DATABASE_URL` is the main step for PostgreSQL. The seed creates:

| Product | Type | Annual rate |
|---|---|---:|
| Home Loan | LOAN | 6.5% |

Conversations own messages and maintain a title plus last-message timestamp for efficient history listing. Assistant messages may own a calculation audit row containing its type, normalized input JSON, result, unit, formula version, and optional product reference.

The triggering user message is committed before the external OpenAI call so an upstream failure does not erase the request. A successful assistant message and its calculation audit row are committed in one Prisma transaction. Conversation history is database-backed; local storage remembers only the currently selected conversation ID.

## Financial formulas

Compound interest, compounded `n` times per year:

```text
A = P(1 + r/n)^(nt)
```

Monthly amortized loan payment, with `i = annualRate / 12` and `N = years * 12`:

```text
M = P * i(1 + i)^N / ((1 + i)^N - 1)
```

The zero-interest case is handled separately as `P / N`. Inputs are bounded and calculations use Decimal.js; currency results are rounded half-up to two decimal places.

## Validation, security, and failure handling

Validation is intentionally layered:

1. Shared strict Zod schemas validate HTTP requests and API responses.
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

See [.env.example](.env.example). Important controls include an explicit CORS origin, per-IP rate limiting, request body limits, OpenAI timeout/retries, and maximum conversation context.

## Docker

```bash
docker compose up --build
```

The multi-stage image runs as an unprivileged user and persists SQLite under the named `data` volume. The single container serves the built web client from the API in production.

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

- This is an educational calculator, not financial advice. Currency is displayed as USD because the assignment examples use dollars.
- Rates are nominal annual percentage rates. Loan terms are whole months; years may contain decimals if they map to a whole month.
- Compound-interest questions default to annual compounding only when the user omits frequency; the assistant states that assumption.
- Product names use case-insensitive exact matching after normalization; fuzzy catalog search is intentionally excluded.
- Authentication is out of scope for the requested single-user assessment. Conversation IDs are unguessable CUIDs, but a real multi-user deployment must add identity and ownership checks.
- SQLite is appropriate for a portable assessment, not horizontally scaled writes. Production would use PostgreSQL, managed secrets, TLS termination, distributed rate limiting, and centralized telemetry.
- LLM output is nondeterministic. Deterministic formulas and tool validation are comprehensively tested; live model calls require a valid key and are intentionally not part of CI.
- The assistant supports natural in-scope conversation, but remains deliberately scoped to compound interest and monthly loan payment calculations. Missing values are requested in a follow-up instead of guessed. Programming, SQL, cybersecurity, general knowledge, and other unrelated requests receive a deterministic scope redirect.

## AI-assisted development disclosure

AI assistance was used to accelerate scaffolding, test design, documentation, and review. Every trust-boundary decision, formula, validation rule, database write, and error path is represented in deterministic code and tests and should be understood by the submitter before the technical discussion.
