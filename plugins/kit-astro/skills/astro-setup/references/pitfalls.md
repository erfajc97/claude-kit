# Pitfalls: symptom -> rule -> fix

Real mistakes that cost rework. Read the group that matches the task before starting, and the
"Verification" group before saying done.

## Console and hydration

1. **`Hydration failed: server rendered text didn't match`, and the admin table takes seconds to
   appear after navigating** -> WA2 -> static build + `<ClientRouter />` + QueryClient singleton:
   the prerendered HTML is the loading state, the island hydrates against cached data. Data
   islands use `client:only="react"`, not `client:load`. React rebuilding the tree was the slowness.
2. **A `client:only` island leaves a blank area until it hydrates** -> WA2 -> give it an `.astro`
   skeleton in `slot="fallback"` (`<Users client:only="react"><TableSkeleton slot="fallback" /></Users>`).
   The skeleton is `.astro` (zero JS), never a React island. A table skeleton and a form skeleton
   cover most pages.
3. **Every island with text reports a hydration mismatch when the visitor's language is not the
   default** -> WA2, W3 -> the provider read the stored locale in the first client render while
   the server rendered the default. Mount-gate it (AppProviders renders the server locale until
   hydrated, then the stored one), or pass the URL's `locale` prop. Translated attributes
   (`aria-label`) mismatch too and React does not patch them. Every island with text must sit
   inside the gated provider. Verify with the non-default locale stored and a full reload.
4. **Mismatch from `window`, `localStorage`, `Date.now()` or a persisted store in the first
   render** -> WA2 -> read client-only values after hydration (`useHydrated`, an event handler,
   `persist` with `skipHydration` + `rehydrate()` after mount).
5. **`A PressResponder was rendered without a pressable child` on every dialog** -> WA8 -> a
   controlled `<Modal>` without a trigger. Control `Modal.Backdrop` directly (`AppModal`). A
   hidden `tabIndex={-1}` trigger only swaps it for `<Pressable> child must be focusable`.
6. **`you must specify an aria-label or aria-labelledby`** (Select, ComboBox, icon button) ->
   W10 -> a sibling `<Label>` is not associated. `useId()` + `aria-labelledby`, or `aria-label={t(...)}`.
7. **Only the shared wrapper was fixed and the warning is still there** -> W7 -> apps grow their
   own dialog wrappers, hand-built modals and raw `<Select>` with custom values. Grep `<Modal`,
   `<Select`, `<Switch`, `<Table` across features and fix every match.
8. **`ERR_BLOCKED_BY_CLIENT` for an analytics script** -> not a bug: an ad blocker. Everything
   else in the console is.

## Dev server and build (WA10)

9. **`504 (Outdated Optimize Dep)` / `Failed to fetch dynamically imported module`, an island
   never hydrates (a form that silently does nothing)** -> list every heavy island dependency in
   `vite.optimizeDeps.include` (react, react-dom, jsx runtimes, `@heroui/react`,
   `@tanstack/react-query`, `zustand`, `sonner`, `axios`, `react-hook-form`,
   `@hookform/resolvers/zod`, `zod`), set `devToolbar: { enabled: false }`, hard-reload. Keep the
   list identical across apps of a monorepo.
10. **Deleting `node_modules/.vite` with the dev server running** -> forces a re-optimize with new
    hashes and leaves the open page on 504s. Stop the server first, or touch the config so Astro
    restarts cleanly.
11. **Running `astro check` or `astro build` while `astro dev` runs on the same folder** -> they
    fight over `.vite`; run them with the dev server stopped (or in a separate checkout).
12. **`__dirname is not defined` in `astro.config.mjs`** -> the config is ESM:
    `fileURLToPath(new URL('./src', import.meta.url))`.

## HeroUI v3 (WA8)

13. **v2 API in a v3 project**: `Button color="primary"`, `Button isLoading`, `Input label="..."`,
    `import { useDisclosure } from '@heroui/react'`, `HeroUIProvider` -> `variant`, `isDisabled` +
    label, `TextField + Label + Input` (FormField), local `useDisclosure`, no provider.
14. **`<Switch>` renders empty** -> it needs `Switch.Control` + `Switch.Thumb`: use `ToggleSwitch`.
15. **Invisible labels, white popovers, unreadable chips on a dark page** -> `data-theme` and the
    `dark` class missing on `<html>`, or HeroUI variables not bridged to tokens in `global.css`.

## Forms (W7, W11)

16. **The focus ring of an input looks cut inside a dialog** -> `box-border w-full max-w-full
    focus:ring-inset` on inputs in dialogs (FormField has it).
17. **A stray live-region banner appears near the header when a form validates** -> HeroUI's
    `<Form>` was used. Use a native `<form noValidate>`.
18. **Edit form synchronized with `useEffect(() => setForm(prop), [prop])`** -> W3 (banned) ->
    re-create the form with a `key` per opening, or `form.reset(values)` in the click handler.
19. **`type="number"` for prices, or an empty amount saved as `0`** -> W11 -> text input with
    `inputMode="decimal"`; the schema rejects blanks and normalizes the comma.
20. **`z.string().email()`** -> Zod v4: `z.email()`, `z.url()`, `z.uuid()`.
21. **Field limits that differ from the API** -> W11 -> mirror the DTO (email <= 254 and
    lowercased, password 8-128, trimmed text with a max) and reuse the same constant as `maxLength`.

## Data and errors (W4, W5, W6)

22. **The toast says "Error" and nobody knows why, or it prints the backend's English message** ->
    W6 -> `onError: (error) => toastApiError(error, 'feature.toast.actionFailed')`: the code goes
    through `translateError`; the backend `message` is never shown or compared.
23. **A service catches the AxiosError and throws `new Error(message)`** -> the code is lost.
    Let the AxiosError propagate.
24. **`x.toFixed is not a function` on a price** -> money arrives as a decimal string. Display with
    `formatMoney` (`Intl.NumberFormat`); compute with the decimal helper; never `toFixed` on the
    raw value.
25. **`Cannot read properties of undefined (reading 'ordersCount')` on a thin payload** -> the DTO
    type declares what the API may omit; the service mapper fills defaults; a test feeds it a
    partial payload. A crashed island has no error boundary to fall back on.
26. **The list does not refresh after a mutation, or refreshes only sometimes** -> W4 -> invalidate
    with the exported `*_KEY` (prefix match), never a retyped literal.
27. **Admin rows jump when a status is toggled** -> recommended pattern: admin endpoint ordered by
    `createdAt asc`, simple invalidate; no optimistic `setQueryData`, no `orderBy isActive`.
28. **The dialog closes even when saving failed** -> W5 -> close in the per-call `onSuccess`, never
    in `onSettled`.
29. **`window.confirm('Delete?')`** -> W5 -> `ConfirmDialog` + toast in the mutation.
30. **Duplicate toasts, or toasts in two corners** -> WA3 -> exactly one island per page passes
    `withToaster`.
31. **`fetch` inside a `useEffect`** -> W3 -> a query or a mutation.

## State and islands (WA3)

32. **State shared through React Context "does not update" between the header and another
    island** -> islands are separate React trees; share through a Zustand store.
33. **Two islands show different data for the same query** -> one of them created its own
    `QueryClient`. Import the singleton (through `AppProviders`).
34. **A bundled script stops working after the first navigation** -> WA4 -> bind inside
    `astro:page-load`.
35. **The theme flips back to light after navigating** -> WA4 -> ClientRouter replaced the
    `<html>` attributes; re-apply on `astro:after-swap` (BaseLayout does it).

## Auth and security (W14, WA7, WA11)

36. **Tokens in localStorage, encrypted with a key that ships in the bundle** -> not security:
    the key is public. Access token in memory, refresh token in an httpOnly cookie.
37. **N parallel 401s fire N refresh calls (and rotate the refresh token N times)** -> single
    flight: one shared refresh promise (`refreshSession`).
38. **Private data visible in the prerendered HTML (view-source)** -> WA11 -> never fetch private
    data in the frontmatter of a static page; client-only gated island.
39. **A secret reachable from the client** (`import.meta.env.SECRET`, a `context: 'client'`
    secret) -> WA7 -> secrets are `envField` with `context: 'server', access: 'secret'`, read in
    server code only. Client code reads `astro:env/client` through `env.ts`.
40. **`set:html={JSON.stringify(data)}` for JSON-LD** -> W14 -> replace every `<` with its JSON
    unicode escape (as `BaseLayout.astro` does) so a value cannot close the script tag.
41. **`returnTo` used as-is after sign-in** -> open redirect. Accept only same-site paths
    (`safeReturnTo`).
42. **Sign-out leaves the previous user's data in the cache** -> `queryClient.clear()` on sign-out.

## Styling and i18n (W8, W12, WA9)

43. **Hex, `oklch()`, `var(--...)`, `text-white`, `bg-gray-*` in a className** -> W8 -> token
    classes only; literal colors live in `global.css`.
44. **A key added to one locale shows the raw key in the other language** -> W12 -> every key in
    every locale file in the same change (`Record<MessageKey, string>` makes `tsc` fail).
45. **Page title, description or `alt` hard-coded** -> W12, WA6 -> translate in the frontmatter
    with `getT(locale)`; hard-coded meta also breaks hreflang pairs.
46. **v3 Tailwind classes** (`shadow-sm` meaning the old small shadow, `bg-gradient-to-r`,
    `flex-shrink-0`, leading `!`) -> WA9 -> v4 canonical names (components-ui.md §10).

## TypeScript and lint (W16)

Follow the project's ESLint and TypeScript config; do not add code the types already rule out.

47. **`as Type` where the expression already has that type** -> remove the assertion. An
    assertion is only for a narrowing TypeScript cannot infer; check `types.ts` first.
48. **`obj.prop?.x` where `prop` is required** -> `obj.prop.x`. Optional chaining only where the
    type says optional.
49. **`if (!x) return null` where the type guarantees `x`** -> remove the guard; fix the type if
    the data can really be missing (and default it in the mapper).

## Verification (W16, G10)

50. **"Done" after typecheck and lint only** -> they do not see react-aria warnings or hydration
    errors. Open every touched page and its dialogs in the browser, at 360 px and at desktop, in
    both themes, and read the console: zero errors and zero warnings (ad-blocker noise aside).
    Then lint, typecheck, tests and build, reading each exit code.
