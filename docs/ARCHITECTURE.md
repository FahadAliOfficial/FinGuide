# Architecture and engineering decisions

## Goals

1. Make the backend calculation the only source of numeric truth.
2. Keep model-provider and database details replaceable.
3. Make the submission trivial to run and credible to operate.
4. Preserve a useful audit trail without storing secrets or hidden model reasoning.

## Request sequence

```text
Client        HTTP/API       Orchestrator       OpenAI        Product DB     Finance svc
  | POST chat    |                |                |               |              |
  |------------->| validate       |                |               |              |
  |              |--------------->| intent/tools   |               |              |
  |              |                |--------------->|               |              |
  |              |                |<-- typed call--|               |              |
  |              |                | validate args  |               |              |
  |              |                |------ lookup (when named) ---->|              |
  |              |                |<------------- product/rate ----|              |
  |              |                |---------------- calculate ------------------->|
  |              |                |<--------------- exact result -----------------|
  |              |                | tool output    |               |              |
  |              |                |--------------->|               |              |
  |              |                |<-- explanation-|               |              |
  |              |                | atomic persist |               |              |
  |              |<---------------| response       |               |              |
  |<-------------|                |                |               |              |
```

For complete supported requests, the second model call receives the backend result as a tool output. The system prompt prohibits recomputation or changed figures. The API also returns the structured backend calculation alongside prose, so consumers never need to parse the model's text.

Every turn uses `tool_choice: required` and must select exactly one strict native function. Complete calculations select one of the two financial tools. Other turns select `respond_to_user` with a constrained category for greetings, capabilities, formula questions, supported education, missing-parameter clarification, or out-of-scope input. Capability, formula, and out-of-scope text is owned by the backend; any model-drafted content for those categories is discarded. These turns are persisted as ordinary assistant messages and return `calculation: null`; they never create a calculation audit row. A numeric financial result still requires a financial tool and the verified formula path.

## Components

- `domain`: pure formulas, typed values, and errors. No HTTP, OpenAI, or Prisma imports.
- `application`: the chat use case, conversational/calculation outcome handling, ports, validated command execution, and persistence coordination.
- `infrastructure`: Prisma repositories and the OpenAI Responses API adapter.
- `routes` / `middleware`: transport validation, rate limits, security headers, request IDs, and safe error mapping.
- `web`: a small accessible React chat client; it has no API key or finance logic.

Dependencies point inward. The orchestrator depends on interfaces, allowing deterministic fakes in tests.

## OpenAI integration

The model receives three strict function schemas: two financial operations and one conversational-control operation. `strict: true` constrains tool arguments; Zod still validates at the trust boundary because model output is untrusted external input. The tool executor uses a fixed name-to-handler map—never `eval`, dynamic imports, or arbitrary dispatch. Required tool selection fails closed when no function call is returned. The OpenAI key remains in the API process.

Conversation context is read from our database and bounded by count and message length. We do not depend on provider-side conversation retention. This keeps data ownership and replay behavior explicit.

## Data model

- `Conversation`: stable thread identity, first-message title, and indexed last-message timestamp for the recent-session list.
- `Message`: ordered USER/ASSISTANT content.
- `Calculation`: one-to-one with the assistant message; normalized inputs, numeric result, display unit, formula version, and optional product provenance.
- `FinancialProduct`: catalog name/type/rate with active status and timestamps.

The successful assistant message and calculation are written in one transaction. The initial user message is committed before external model work, preserving what triggered an upstream failure. A safe assistant error is also recorded when processing fails.

The client obtains recent sessions from `GET /api/v1/conversations` and loads a selected thread from `GET /api/v1/conversations/:id/messages`. Local storage remembers only the last selected ID; the database remains the source of truth for history. Listing uses a bounded, newest-first query and never loads full transcripts.

## Threat model and controls

| Risk | Control |
|---|---|
| Prompt injection / arbitrary action | Two allow-listed financial tools plus one non-executing conversational-control tool; no general network/database tool; server validates every argument |
| Out-of-scope answer leakage | Required conversational classification; backend replaces capability and out-of-scope drafts with deterministic responses |
| LLM arithmetic hallucination | Pure backend formulas; structured result returned separately; explanation prompt receives verified output |
| Secret exposure | Server-only environment validation; redacted logs; generic production errors |
| Cost / resource abuse | Body limit, message limit, rate limit, bounded history, model timeout and retry cap |
| SQL injection | Prisma parameterized queries; no raw SQL in request paths |
| Cross-origin abuse | Explicit configured origin and restrictive Helmet headers |
| Object guessing | CUID identifiers; documented need for authenticated ownership in multi-user production |
| Numeric abuse | Finite decimal parsing plus domain bounds for principal, rate, term, and compounding |
| Partial audit writes | Prisma transactions for assistant result + calculation |

## Reliability and observability

Every request gets an `X-Request-Id`. Logs are structured, secrets and authorization headers are redacted, and errors use stable codes. Health checks are cheap and model-independent. OpenAI calls have bounded timeouts and retries. The client prevents duplicate submits and exposes retry-friendly errors.

## Scaling path

Replace SQLite with PostgreSQL, in-memory rate limits with Redis, and the single API replica with stateless replicas. Add OpenTelemetry traces, metrics for model latency/tool choice/validation failures, a queue only if response latency is allowed to become asynchronous, and user authentication with row ownership. None of these change domain code.

## Deliberate trade-offs

- Express instead of a larger framework keeps the evaluator's review surface small; module boundaries and dependency injection retain structure.
- REST instead of WebSocket/SSE is sufficient for short answers. Streaming would complicate atomic persistence and error recovery without improving the stated rubric.
- No RAG/vector store: the only grounding source is one relational product row, so semantic retrieval would be needless complexity.
- No Redis in the local build: per-process limits are enough for one assessment instance; the scaling replacement is explicit.
