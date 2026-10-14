---
name: astro-setup
description: Stack knowledge for Astro + React islands web projects (public landings, blogs, ecommerce, dashboards, admin panels) built with TanStack Query, HeroUI v3, Tailwind CSS v4, Zustand and react-hook-form + zod. Use it when creating an Astro project or adding a feature to one: structuring feature folders, composing .astro pages with islands and choosing hydration directives, writing layouts with SEO metadata and light/dark theming, shared queries with *_KEY constants, mutations with code-based error toasts, services and the axios client (in-memory access token, httpOnly refresh cookie, single-flight refresh), typed astro:env, HeroUI v3 wrappers (dialogs, tables, pagination, switches, form fields), i18n, ClientRouter view transitions, auth gating in static builds and SEO-first public pages. Also use it to diagnose hydration mismatches, react-aria console warnings, Vite "Outdated Optimize Dep" errors and other Astro/HeroUI pitfalls.
---

# Astro + React islands

Static-first web apps: `.astro` pages render content as HTML with zero JS, and React islands
hydrate only where a visitor interacts (forms, dialogs, tables, filters, carts). Inside the
islands the code follows a screaming architecture: features named after the business, dumb
components, logic in hooks, server state in TanStack Query, cross-island state in Zustand.

The binding rules live in the project's `CLAUDE.md` as `W1...W16` (any React web) and
`WA1...WA11` (Astro). This skill shows how to satisfy them in this stack and cites them by ID.
When `.claude/kit.json` exists, its `brand`, `locale` and `commands` override the defaults here.

## Rule map

| Rule | What it means in this stack | Details |
|---|---|---|
| W1 | one island root per feature; `components/ hooks/ mutations/ services/ helpers/ __tests__/ types.ts data.ts schema.ts`; queries in `src/app/tanstack-queries/`; no cross-feature imports | structure.md §2 |
| W2 | components render props; one feature hook per screen component | structure.md §2 |
| W3 | derive -> handler -> query/mutation -> store persist -> `key` reset -> mount gate -> commented effect | structure.md §9 |
| W4 | QueryClient singleton, `*_KEY` constants, invalidate by the constant, `isLoading` gates skeletons | data-layer.md §4 |
| W5 | toasts only in mutations; dialogs close in `onSuccess`; `ConfirmDialog`, never `window.confirm` | data-layer.md §5 |
| W6 | `toastApiError` -> `translateError(code)` -> `t('errors.<code>')`; backend `message` never shown | data-layer.md §6 |
| W7 | wrappers in `src/app/components/UI/`; native `<form noValidate>` | components-ui.md |
| W8 | token classes only; literal colors only in `global.css` (light + dark) | structure.md §8 |
| W9 / W10 | 360 px first, 44 px targets; accessible names, visible focus, reduced motion | components-ui.md §9 |
| W11 | react-hook-form + zod v4 mirroring API limits; no `type="number"`; empty is not zero | feature-implementation.md §2 |
| W12 | `t('ns.key')` everywhere; typed keys present in every locale | structure.md §7 |
| W13 | loading / error-with-retry / empty / data; resilient images | components-ui.md §8 |
| W14 | public env only; escaped JSON-LD; access token in memory, refresh token httpOnly | routing-and-auth.md §5 |
| W15 | Vitest + RTL; mock services; real providers; invalidation proven by effect | data-layer.md §9 |
| W16 | project ESLint/TS config green; no redundant `as`, `?.` or guards | pitfalls.md |
| WA1 | static by default; React only for interactivity | structure.md §4 |
| WA2 | `client:visible` > `client:idle` > `client:load`; data islands with ClientRouter = `client:only` + `.astro` fallback | structure.md §4 |
| WA3 | Zustand across islands, one QueryClient, one Toaster per page | structure.md §3 |
| WA4 | `astro:page-load`, `astro:after-swap`, `transition:persist` | routing-and-auth.md §3 |
| WA5 | hover prefetch, immutable `/_astro/*`, `no-store` private HTML | routing-and-auth.md §4 |
| WA6 | title <= 60, description 100-155, canonical, OG/Twitter, JSON-LD, one h1, sitemap, robots, `noindex` private | landing.md §4 |
| WA7 | `envField` schema; `astro:env/client` through `env.ts`; secrets server-only | templates/astro.config.mjs |
| WA8 | HeroUI v3 APIs, controlled `Modal.Backdrop`, Switch parts, local `useDisclosure` | heroui-v3.md |
| WA9 | Tailwind v4 canonical classes | components-ui.md §10 |
| WA10 | `optimizeDeps.include`, dev toolbar off, never check/build against a live `.vite` | pitfalls.md (dev server) |
| WA11 | no private data in prerendered HTML; client-only `AuthGate`; middleware for on-demand routes | routing-and-auth.md §5 |

## References

| File | Read it when |
|---|---|
| `references/structure.md` | creating the project, a feature, an island root, the i18n layer, the theme toggle, deciding `.astro` vs `.tsx` |
| `references/data-layer.md` | writing services, queries, mutations, error handling, money, tests |
| `references/feature-implementation.md` | building a CRUD feature end to end (worked `users` example) |
| `references/components-ui.md` | writing or using wrappers, states, mobile-first and a11y details, Tailwind v4 names |
| `references/heroui-v3.md` | any HeroUI component, theming, v2 -> v3 differences |
| `references/routing-and-auth.md` | pages, dynamic/on-demand routes, ClientRouter, prefetch, sign-in, gating |
| `references/landing.md` | public pages, sections, SEO checklist, JSON-LD, robots |
| `references/icons-and-assets.md` | icons, images, resilient images |
| `references/pitfalls.md` | before starting (matching group) and before saying done (Verification) |

## 1. New project

```bash
npm create astro@latest
npm i @astrojs/react @astrojs/sitemap react react-dom \
  @tanstack/react-query @heroui/react @heroui/styles framer-motion \
  axios zustand sonner react-hook-form @hookform/resolvers zod
npm i -D tailwindcss @tailwindcss/vite @types/react @types/react-dom \
  vitest jsdom @testing-library/react @testing-library/jest-dom
```

Money arithmetic adds a decimal library (for example `big.js` + `@types/big.js`).

Copy the templates (they are the source of truth; adapt names, never the rules they encode):

| Template | Destination | Provides |
|---|---|---|
| `astro.config.mjs` | `astro.config.mjs` | site, sitemap, i18n routing, prefetch, typed env, alias, optimizeDeps, no dev toolbar |
| `global.css` | `src/styles/global.css` | light/dark tokens, Tailwind `@theme inline`, HeroUI bridge |
| `BaseLayout.astro` | `src/layouts/BaseLayout.astro` | html shell, `lang`, SEO props, JSON-LD, theme before paint, ClientRouter |
| `PublicLayout.astro` | `src/layouts/PublicLayout.astro` | skip link, static header/footer, header island hosting the Toaster |
| `AppProviders.tsx` | `src/app/providers/AppProviders.tsx` | QueryClient, locale mount gate, the page's single Toaster |
| `queryClient.ts` | `src/app/lib/queryClient.ts` | singleton; no retries on 4xx |
| `env.ts` | `src/app/config/env.ts` | typed public config; the test seam for `astro:env` |
| `apiClient.ts` | `src/app/api/apiClient.ts` | axios with credentials, bearer token, single-flight refresh, session bootstrap |
| `endpoints.ts` | `src/app/api/endpoints.ts` | every API path |
| `authStore.ts` | `src/app/store/auth/authStore.ts` | in-memory session, roles, status |
| `sonnerResponse.ts` | `src/app/helpers/sonnerResponse.ts` | the only door to the toaster |
| `translateError.ts` | `src/app/helpers/translateError.ts` | error code -> i18n key |
| `toastApiError.ts` | `src/app/helpers/toastApiError.ts` | coded error toast with a fallback key |
| `useDisclosure.ts` | `src/app/hooks/useDisclosure.ts` | dialog state (HeroUI v3 has none) |
| `middleware.ts` | `src/middleware.ts` | private on-demand routes: redirect, `noindex`, `no-store` |

Then write, from the references: `src/app/i18n/` (structure.md §7), the wrappers in
`src/app/components/UI/` (components-ui.md), `AuthGate` + `sessionQuery.ts`
(routing-and-auth.md §5), the skeletons, the header and footer, `robots.txt.ts`, and
`vitest.config.ts` + `src/test/setup.ts` (data-layer.md §9).

Environment: `.env` is git-ignored; `.env.example` lists every variable of the `env.schema` with a
placeholder (`PUBLIC_API_URL=http://localhost:3000`). Only `PUBLIC_*` client variables reach the
bundle; secrets are `context: 'server', access: 'secret'`.

## 2. Architecture in one page

```text
.astro page (static HTML, SEO, zero JS)
 ├─ static sections (.astro)            <- most of the page
 └─ island root <Feature client:*>      <- only where a visitor interacts
      └─ AppProviders (QueryClient singleton, locale, Toaster on one island)
           └─ Screen component -> feature hook -> shared query / mutations -> service -> apiClient
```

- Each island is its own React tree: every root wraps `AppProviders`; state crosses islands only
  through Zustand stores; all islands share one QueryClient and one Toaster per page.
- Pages pass server-known data (and `locale`) as props; islands fetch only what is private,
  per-visitor or live.
- Private screens in a static build: static heading + `client:only="react"` island inside
  `AuthGate` + `.astro` skeleton fallback; `noindex`.

## 3. Workflow for a feature

1. `types.ts`: DTOs, domain types, params.
2. Endpoint in `endpoints.ts`; service functions with the DTO <-> domain mapping.
3. Shared query in `src/app/tanstack-queries/<domain>Query.ts` with the exported `*_KEY`.
4. `mutations/use<Feature>Mutations.ts`: service + success toast + invalidate by `*_KEY` +
   `toastApiError`.
5. `schema.ts` for forms (zod v4, limits mirroring the API, messages as i18n keys).
6. Hooks: page orchestration, table/list state, form.
7. Components: dumb, one per file; `.astro` for anything static.
8. Island root `<Feature>.tsx` wrapping `AppProviders` (and `AuthGate` when private).
9. Page `.astro`: layout + translated meta + static heading + island with the right directive.
10. i18n keys in EVERY locale file.
11. Specs next to each step (`__tests__/`): services, mutations (invalidation by effect),
    hooks, screens.
12. Verify (pitfalls.md, Verification): browser console clean on the page and its dialogs, 360 px
    and desktop, light and dark, then lint, typecheck, tests and build with their exit codes.

## 4. Checklist before "done"

- [ ] WA1/WA2: everything static is `.astro`; directives justified; data islands under
      ClientRouter are `client:only` with an `.astro` fallback; no client-only read in a first render.
- [ ] WA3: each island root wraps `AppProviders`; one Toaster on the page; cross-island state in Zustand.
- [ ] W1/W2: feature folder shape; one component per file; no cross-feature imports; components dumb.
- [ ] W3: no `useEffect` in components; every effect in a hook names the external system it syncs.
- [ ] W4: queries in `tanstack-queries/` with `*_KEY`; invalidation by the constant; four view states.
- [ ] W5/W6: toasts only in mutations; `toastApiError` in every `onError`; dialogs close in `onSuccess`;
      no backend `message` on screen; no `window.alert/confirm/prompt`.
- [ ] W7/WA8: wrappers only; native `<form noValidate>`; controlled dialogs via `Modal.Backdrop`;
      `ToggleSwitch`; selects with an accessible name; in-dialog inputs with `focus:ring-inset`.
- [ ] W8/WA9: token classes only; both themes checked; Tailwind v4 names.
- [ ] W9/W10: 360 px, 44 px targets, keyboard path, visible focus, labels and `aria-label`s translated.
- [ ] W11: zod v4 (`z.email()`), limits = API limits = `maxLength`; decimals as text, blank rejected.
- [ ] W12: no literal UI copy in `.tsx`/`.astro` (meta and `alt` included); keys in every locale.
- [ ] W14/WA7/WA11: nothing secret in the client; no tokens in storage; no private data in static
      HTML; private pages `noindex`; `returnTo` validated.
- [ ] WA6: title, description, canonical, OG/Twitter, JSON-LD, one h1, sitemap/robots updated.
- [ ] W15: specs assert behaviour; services mocked, providers real; stubs with `data-testid`.
- [ ] W16/WA10: console clean (pages + dialogs); lint, typecheck, tests, build green by exit code;
      old code deleted, not patched around.
