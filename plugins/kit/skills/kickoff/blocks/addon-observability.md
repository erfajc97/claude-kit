<!-- kit:block addon-observability v1 -->
## Rules — Observability (`OB`)

Error tracking, product analytics, logs, heartbeats and bot protection are reached only
through adapters, work without keys, and never carry personal data. Base rules this block
builds on instead of repeating: vendor SDKs behind a port with timeouts (A9), structured
logs with a request id (A15), the mobile reporting module (M12), env variables (G9) and no
silent `catch` (G18).

OB1. **SDKs only inside adapters.** A provider SDK (`@sentry/*`, `posthog-js`,
     `posthog-node`, `@logtail/*`, `@datadog/*`, `mixpanel*`, bot-protection SDKs…) is
     imported only under `**/observability/adapters/**` — static or dynamic `import()` —
     and a lint rule enforces it. App code calls the facade (`captureError`, `trackEvent`,
     `ErrorReporter.capture`, `AnalyticsService.track`, `HeartbeatService.ping`). Swapping a
     provider is a new adapter, not an app change. Why: a direct import is where scrubbing
     and the no-op are skipped. Check: `/kit:audit quick` (OB1 import check); Grep for
     `eslint-disable` next to such imports.

OB2. **No-op without keys.** With every key empty (dev, test, CI, and production until the
     owner pastes them) each adapter is a no-op: no SDK download, no network, no listeners,
     no timers. A test per adapter proves it. Production makes a key mandatory only through
     the env schema, by an explicit decision. Why: observability must never be the reason a
     process fails to boot or a test hits the network. Check: each adapter has a "no key"
     test asserting no SDK init and no request; run them.

OB3. **No personal data in events or reports.** Events and error contexts carry ids
     (hashed for analytics) and enums only — never names, emails, phones, documents,
     addresses, free text typed by a user, or amounts of an identifiable person. Error
     reports drop request bodies, cookies, auth headers and query strings; `before_send`
     strips query and fragment from every URL; breadcrumbs drop console and query;
     autocapture, heatmaps, session recording and dead-click capture are off IN CODE. Why:
     analytics has more readers than the database. Check: Grep
     `trackEvent\(|\.track\(|captureException\(|captureError\(` in touched files and read
     every property; a spec asserts the exact set of keys the scrubber keeps (FT20).

OB4. **Success and failure for every action.** Every mutation and every service with I/O
     emits a success event AND a failure event (`domain_action` in snake_case, e.g.
     `order_paid`, `order_payment_failed`); multi-step flows emit one event per step. One
     emitter per fact: the API emits the success; a client emits only what the API cannot
     see (a network cut) with an `origin` property; names and outcomes match across clients.
     The number in an event is the ACTION's, not the screen's state. Why: without both
     events there is no funnel and failures are learned from customers. Check: for each
     touched mutation/service, Grep the success and failure event names; Grep the same
     event name in two emitters.

OB5. **Errors captured once; business errors are not errors.** A 4xx with an error code
     is business: it goes to analytics (`*_rejected { reason }`), not to error tracking.
     Network failures and 5xx are captured exactly ONCE — by the HTTP interceptor or by the
     `onError`, never both. Why: duplicated or noisy reports bury the real ones. Check: read
     each touched `onError`/`catch` against the interceptor's behaviour; Grep
     `window\.Sentry|window\.posthog` → zero (module SDKs do not define globals).

OB6. **Heartbeats, uptime and shutdown.** Every cron or periodic job pings its heartbeat
     AFTER a successful run (never before, never in the `catch`) and reports its failure;
     endpoints critical to charging or delivering have an uptime monitor; an admin-only
     health endpoint reports which integrations are configured, as booleans only; buffered
     clients flush on shutdown within a deadline (timeouts in general: A9). Why: a job that
     silently stops is found by the customer, and a flush without a deadline ate the whole
     shutdown window. Check: Grep `@Cron|@Interval|setInterval\(|schedule\(` in touched code
     for a heartbeat ping after success and an error capture.

OB7. **Real SDK in tests, live check after deploy.** Integrations are tested with the real
     library and real providers (FT22). After deploy the owner verifies that the app's OWN
     events arrive (not only page views) and that a test error lands. Why: a fake global
     kept a test green while production sent zero events for a month. Check: Grep tests for
     `window\.(posthog|Sentry)\s*=` → FT22 finding; the auditor adds the live check to
     "Notes for the owner".

OB8. **Consent where required.** Public sites load analytics only after consent when the
     jurisdiction requires it; events before consent are dropped, not queued; revoking stops
     collection. Why: legal exposure, not just hygiene. Check: the public layout's analytics
     init is gated by the consent state; a test denies consent and asserts no init.
<!-- /kit:block addon-observability -->
