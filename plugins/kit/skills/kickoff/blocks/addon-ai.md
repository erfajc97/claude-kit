<!-- kit:block addon-ai v1 -->
## Rules — AI providers (`AI`)

Language and vision models are reached through ONE service. The AI proposes; a person
confirms. Base rules this block builds on instead of repeating: vendor adapters with
timeouts (A9) and background work off the request (A10).

AI1. **One AI service.** Only the AI module's `providers/` folder imports provider SDKs
     (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@mistralai/*`, `groq-sdk`, `cohere-ai`,
     `ollama`…); every other module calls a named task on the service
     (`ai.extractDocument()`, `ai.summarize()`…). A lint rule enforces it. A direct import
     elsewhere is a BLOCKER. Why: one door for policy, metering, fallback and audit. Check:
     `/kit:audit quick` (AI1 import check).

AI2. **Typed tasks, validated output.** Each task has an input type with the minimum data
     and an output schema; model output is validated before it touches data. Invalid output
     gets one repair attempt, then the fallback route, then a controlled error with a code.
     Unvalidated model text never reaches the database or another system. Why: a model that
     invents a field must not create a record. Check: every task in the service parses its
     output with a schema (Grep `\.parse\(|safeParse\(` per task); a test feeds invalid JSON
     and asserts repair → fallback → error code.

AI3. **Routes are configuration.** Provider, model, fallback and prices per task live in
     configuration (database or validated config), editable without a deploy; there is no
     hidden default provider in code. A task without an active route fails closed with a
     code. Retries are bounded and the fallback is applied per call; documents, audio and
     batches run as background jobs (A10). Why: switching a provider must not require a
     release. Check: Grep the service for model or provider string literals → finding; a
     test with no route expects the error code.

AI4. **The AI proposes, the user confirms.** Anything that sends a message, changes a
     record of consequence or deletes data runs only after an explicit user confirmation
     through a confirm endpoint separate from the propose endpoint — except automations the
     user explicitly turned on. The UI distinguishes proposed from confirmed content.
     Content coming from documents or messages (prompt injection) can never trigger an
     action by itself. Why: an AI action without a human is a liability. Check: every
     AI-originated write has a propose route and a confirm route; a test calls confirm
     without a pending proposal → 4xx; Grep handlers that write directly from model output.

AI5. **Metered and logged.** Every provider call — including failures and fallbacks — is
     logged with tenant, user, task, provider, model, status, tokens in/out, minutes or
     pages, cost (from the route's prices), latency and `isFallback`. Variable consumption
     goes through the usage meter that checks the plan limit and records the usage event in
     the same transaction; work is reserved before it is queued and released on a
     definitive failure; retries and fallbacks never charge twice. Why: unmetered AI is an
     unbounded bill. Check: each task writes its call log (a test asserts the row); a test
     with the limit reached expects the limit code and no enqueue.

AI6. **Minimal data, allowed providers.** Each prompt carries only the data the task needs
     (first names, masked samples, counts — never full histories or other customers). Only
     paid plans with a no-training clause and allowed processing regions are used (the
     project lists them in a `P` rule or ADR). Secrets and personal data never go to a
     provider that is not on that list. Why: customer data sent to a free tier is a breach.
     Check: read each touched prompt builder's inputs; Grep the route seed/config for
     providers not on the allowed list.

AI7. **Deterministic fake in tests.** A `fake` provider (deterministic, no network, can
     simulate 500, timeout and invalid JSON) is forced in unit, integration, CI and E2E. A
     real-provider evaluation set (with an accuracy gate) runs on demand and on changes to
     prompts, schemas or routes — not on every PR. Why: tests that call a model are slow,
     flaky and expensive. Check: the test env forces the fake provider (Grep the env/setup);
     the eval command exists and its last result is recorded.

AI8. **Versioned prompts.** Prompts live in code with a version (`summarize@v2`) and the
     version is stored with each result. Why: a quality regression must be traceable to the
     prompt that caused it. Check: Grep the providers/prompts folder for version tags and
     the call log for the stored version.
<!-- /kit:block addon-ai -->
