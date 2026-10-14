<!-- kit:block web-common v1 -->
## Rules — Web front-end, React (`W`)

W1. **Feature folders (ANKO).** Every feature under `{{scopes.web.path}}/src/app/features/<feature>/`:
    ```
    <Feature>.tsx   ONE root = the entry (island or route), named after the entity (Contacts.tsx, not ContactsTable.tsx)
    components/     DUMB views, 1 file = 1 component
    hooks/          ALL logic: state, derived data, view decisions, handlers
    mutations/      TanStack mutations: toasts + invalidation by *_KEY
    services/       one function per endpoint + DTO ⇄ domain mapping
    helpers/        pure functions
    __tests__/      every test of the feature
    types.ts  data.ts (constants, options, columns)  schema.ts (forms only)
    ```
    Nothing else at the feature root. Shared queries live in `src/app/tanstack-queries/`,
    shared UI in `src/app/components/UI/` (or the project's UI package), cross-feature
    pure functions in `src/app/helpers/`. No imports between features: what two need moves
    up. When `services/` or `types.ts` do not apply (shared query, shared type), the
    feature says why in a one-line comment in its root. Why: a feature reads the same way
    everywhere and logic is testable in isolation. Check: Glob each touched feature root
    against the list; Grep `features/` imports inside a feature that point to another
    feature → none.
W2. **Dumb components.** Files in `components/` take props and return JSX: no
    `useEffect`, queries, mutations, service or HTTP calls, toasts, tracking or business
    decisions. A decision that lives in JSX (`canEdit`, `showUpgrade`, an amount, whether
    an action is enabled) moves to the hook or a helper with its test. Exception: a
    one-line `setHydrated(true)` mount gate. Why: logic in JSX is logic nobody tests.
    Check: Grep `useEffect|useQuery|useMutation|axios|fetch\(|toast|sonnerResponse|trackEvent`
    in `**/components/**/*.tsx` → none.
W3. **`useEffect` is the last resort and never hits the network.** In this order: derive
    in render → event handler → TanStack Query (`enabled`, `staleTime`) or a mutation →
    store `persist` → reset with `key` → mount gate → effect, with a comment saying why.
    No fetch, mutate, refetch or invalidate inside an effect; dependencies are stable
    (no objects/functions created in render); no `setState` that changes the effect's own
    dependencies; every interval or poll has a stop condition and never starts a tick
    while the previous one runs. Why: an effect that re-runs becomes an endless request
    loop. Check: Grep multiline
    `useEffect\([\s\S]{0,800}?(fetch\(|axios|Service\.|\.mutate\(|mutateAsync\(|refetch\(|invalidateQueries\()`
    → none; Grep `setInterval\(|refetchInterval` and confirm each stop condition; Network
    tab shows no repeated requests on load or navigation.
W4. **Server state only in TanStack Query.** One `QueryClient` singleton (explicit
    `staleTime`, `retry: 1` and no retry on 4xx, `refetchOnWindowFocus: false` unless the
    screen needs it). Shared queries live in `src/app/tanstack-queries/` and export a
    `*_KEY` constant; query keys include every parameter; invalidation uses the exported
    constant, never a literal. A query that needs a session is `enabled` only with a
    session. Server data is never copied into local state or a store; client-only state
    lives in hooks or a store. Skeletons are gated by `isLoading` (a disabled query stays
    `isPending` forever). Why: one cache, one source of truth, no stale copies. Check: Grep
    `queryKey:\s*\[\s*['"]` and `invalidateQueries\(\{\s*queryKey:\s*\[\s*['"]` → none; Grep
    `isPending` used to gate skeletons → none.
W5. **Toasts only in mutations; dialogs close on success.** Success and error toasts
    live in the mutation's `onSuccess` / `onError` (sole exception: the validation gate of
    a hook's `submit()`). A notice shown when a page loads is rendered in the page, not as
    a toast; the reason a control is disabled is shown next to it. Dialogs close in
    `onSuccess`, never `onSettled`; a `mutateAsync` caller handles the rejection (G18). No
    `window.alert/confirm/prompt` (use the confirm-dialog wrapper). Why: closing on settle
    reports an action that failed and discards what the user typed. Check: Grep
    `toast|sonnerResponse` outside `mutations/` and hooks' submit gates → none; Grep
    multiline `onSettled[\s\S]{0,200}?(onClose|onOpenChange\(false|setOpen\(false|setIsOpen\(false)`
    → none; Grep `window\.(alert|confirm|prompt)\(` → none.
W6. **Errors by code.** `onError` reads the code from the API envelope and maps it with
    `translateError(code)` → `t('errors.<code>')`; the backend `message` is never shown
    or compared; an error without a code falls back to a generic copy key. Every code the
    API can return to that screen has copy in every locale and a test. Why: messages are
    not localized and change; codes are the contract. Check: Grep `\.message` in
    `mutations/` and `hooks/` → none (or only inside the fallback for non-API errors); a
    test per code the screen handles.
W7. **UI kit through wrappers.** No raw `<button>`, `<input>`, `<select>`, `<textarea>` or
    `<table>` in `.tsx` outside `src/app/components/UI/` (or the UI package): use the UI
    kit or its wrapper (lint `react/forbid-elements`). Forms use a native
    `<form noValidate>`. Before creating a component, search for an existing one; a
    pattern used twice becomes a wrapper. Icons are one component per file in
    `src/assets/svg/`, never inline `<svg>` in features. Why: one place fixes styling,
    accessibility and kit quirks. Check: Grep `<(button|input|select|textarea|table)[\s>]`
    in `.tsx` outside the wrapper folders → none; Grep `<svg` in `features/` → none.
W8. **Design tokens only.** Colors, radii, fonts, spacing and shadows come from the
    theme tokens (defined once, in the global CSS): no hex/rgb/hsl/oklch literals, no
    `var(--…)` in `className` or `style`, no raw palette classes (`bg-white`,
    `text-black`, `text-gray-500`) in `.tsx` / `.astro`; light and dark themes both work
    through tokens. When `kit.json` sets `brand` (`{{brand}}`), token values, typography,
    imagery and tone match it; without it, only "tokens only" is enforced. Why: a rebrand
    is a token change, not a hunt. Check: Grep `#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(`
    in `.tsx` / `.astro` → none; Grep
    `\b(bg|text|border|ring|fill|stroke)-(white|black|(gray|slate|zinc|neutral|stone|red|blue|green|yellow)-\d+)\b`
    → none.
W9. **Mobile-first from 360 px.** Unprefixed utilities are the phone layout;
    `sm:`/`md:`/`lg:` add the larger ones. Every screen is built and verified at 360 px
    first, then 1280 px: no horizontal scroll at 360, touch targets ≥ 44 px, the right
    keyboard per field (`inputMode`, `autoComplete`), tables become cards on small
    screens, the primary action within thumb reach. Why: most users are on phones and
    desktop-first layouts break there. Check: screenshots at 360×800 and 1280×800 in the
    builder report; the E2E mobile project runs at 360 px wide;
    `document.documentElement.scrollWidth <= 360` on each touched page.
W10. **Accessibility.** Every control has an accessible name (associated label or
    `aria-label`); text contrast meets WCAG AA; focus is visible; everything works with
    the keyboard; async status changes are announced (`aria-live`); one `h1` per page;
    images have `alt` (`alt=""` when decorative); motion respects
    `prefers-reduced-motion`. Why: accessibility bugs are bugs. Check: lint includes
    `eslint-plugin-jsx-a11y` recommended; the browser console has no accessible-name
    warnings; when the project has `@axe-core/playwright`, key pages report 0 serious or
    critical violations.
W11. **Forms mirror the API.** react-hook-form + zod; the schema uses the same shared
    limits as the API DTO (`.trim().max(N)`, e-mail `.max(254)` lowercased, password
    `.min(8).max(128)`) and inputs carry `maxLength`. Amounts and percentages are text
    inputs sanitized as decimals (a comma is a decimal separator in many locales; pasted
    thousands separators are normalized) — never `type="number"`; an empty field is not
    zero (`''` → `undefined`); an invalid amount is flagged, never auto-corrected. Submit
    is disabled while pending; field errors returned by the API in `details` map to their
    field. Why: a client that validates differently from the server either blocks valid
    input or sends invalid input. Check: Grep `type=["']number["']` → none; Grep
    `Number\(` on form values and confirm an empty-string guard; each schema has a test
    with the last passing and the first failing value.
W12. **i18n for every string.** G13 applies to every view: labels, placeholders,
    `aria-label`s, toasts, empty states, page titles and descriptions and the copy in
    `data.ts` all go through `t('ns.key')` from the app's i18n module, with every key in
    every locale in the same change; the default UI locale is `{{locale.ui}}`. The active
    locale is resolved once (stored preference → `Accept-Language` → default) and applied
    after mount so server and client render the same text. Dates, numbers and currency use
    `Intl`-based formatters with the active locale; amounts from the API arrive as decimal
    strings and are formatted, never `toFixed` on the raw value. Why: a missing key shows
    the raw key to users and a hand-formatted number is wrong in half the locales. Check:
    a test compares the key sets of all locales; the G13 greps over touched `.tsx` /
    `.astro` files → none; Grep `toFixed\(|toLocaleString\(\)` on API values → none.
W13. **Loading, empty and error states; resilient images.** Every query renders a
    skeleton (gated by `isLoading`), an empty state with a call to action, and an error
    state with a retry; uploads show progress; buttons are disabled while their action is
    pending. A partial payload does not crash the screen (defaults where the type allows
    absence). Every remote image goes through a safe-image wrapper with fixed dimensions,
    lazy loading below the fold and a placeholder on error. Why: real networks and real
    data are partial. Check: for each `use\w+Query\(` consumer, the hook exposes and the
    root renders loading, empty and error branches, each with a test; Grep `<img` in
    `.tsx` outside the wrapper → none.
W14. **Public env only; no unsafe HTML.** Client code reads only public-prefixed
    variables (G9) through one typed env module; nothing secret reaches the bundle. The access
    token lives in memory and the refresh token in an httpOnly cookie; nothing sensitive
    in `localStorage` / `sessionStorage`. No `dangerouslySetInnerHTML`, `set:html` or
    `innerHTML` with user data (lint `react/no-danger`); redirects and `next=` targets
    only to own routes; no tokens in URLs. Why: anything in the bundle or in storage is
    readable by any script on the page. Check: Grep
    `dangerouslySetInnerHTML|set:html|\.innerHTML\s*=` → none or justified; Grep
    `(localStorage|sessionStorage)\.setItem\([^)]*(token|jwt|session)` → none; Grep
    `import\.meta\.env\.\w+` and `process\.env\.` in client code and confirm each is a
    public variable or a framework flag.
W15. **Tests assert behaviour.** Vitest + React Testing Library (jsdom) for components,
    hooks, mutations, services and helpers: mock at the service boundary (or with MSW),
    never the unit under test; assert what the user sees (roles, labels, text, FT10);
    every stub renders a `data-testid` (FT8); integrations (toaster, providers, query
    client) are the real ones (FT22); invalidation is asserted by its effect using the
    exported `*_KEY` (FT9). The G2 coverage gate applies per file to `hooks/`,
    `helpers/`, `mutations/`, `services/` and the app-level `lib/`, `store/` and
    `tanstack-queries/`. Cross-page flows are Playwright specs owned by the E2E agent.
    Why: a test that mocks what it tests proves nothing. Check: `{{commands.web.test}}`
    exits 0 with the thresholds; Grep tests that `vi.mock` the file they test → none.
W16. **Tooling green and a clean console.** `{{commands.web.lint}}` (ESLint with
    react-hooks, jsx-a11y and canonical-class rules), `{{commands.web.typecheck}}` (strict
    TypeScript), `{{commands.web.test}}` and `{{commands.web.build}}` exit 0 (G10), and the
    browser console is clean (no React, hydration or accessibility warnings) on every
    touched page and its dialogs. Why: runtime warnings are invisible to type checkers and
    linters. Check: run each command and read its exit code; open the page and its dialogs
    and read the console.
<!-- /kit:block web-common -->
