<!-- kit:block web-astro v1 -->
## Rules — Astro + React islands (`WA`)

WA1. **Astro-first.** Everything static is `.astro` (zero JS): layouts, headers, footers,
    heroes, copy, listings without interaction, and the skeletons islands show while they
    load. React islands exist only where there is state, events, queries, forms or
    dialogs. A page mounts ONE feature root per interactive region; data available at
    build or request time is passed as props from the frontmatter instead of being fetched
    again in the browser. Pages live in `src/pages/`, layouts in `src/layouts/`
    (BaseLayout = head, SEO, fonts, theme init; app and public layouts on top). Why: every
    island is JavaScript the user downloads and hydrates. Check: Grep `src/pages/**/*.astro`
    for more than one feature root per region; review new `.tsx` files without hooks,
    state or handlers → they should be `.astro`.
WA2. **Hydration directives and an SSR-safe first render.** Prefer `client:visible` >
    `client:idle` > `client:load` (load only for above-the-fold controls used at once).
    Islands that render query data in a static build with `<ClientRouter />` — and every
    authenticated screen — use `client:only="react"` with an `.astro` skeleton in
    `slot="fallback"`, never a blank area. The first client render must equal the server
    HTML: never read `window`, `localStorage`, `sessionStorage`, `location` or a cookie in
    `useState` initializers or render; use a mount gate. Why: a mismatch makes React throw
    away and rebuild the whole island. Check: Grep `client:only` lines and confirm a
    `slot="fallback"` child; Grep
    `useState\(\(\) =>[^)]*\b(window|localStorage|sessionStorage|location|document\.cookie)`
    → none; the console shows no hydration errors.
WA3. **Islands share state through stores.** One `QueryClient` module singleton is
    shared by every island; each island root wraps itself in the app providers; exactly
    one toaster per page (`withToaster` on one island). State shared between islands lives
    in Zustand stores, never React Context (each island is a separate React tree). Why:
    Context silently does not cross islands and two toasters duplicate every toast. Check:
    Grep `new QueryClient\(` → exactly one; count toaster mounts per page → 1; Grep
    `createContext\(` and confirm its consumers live in the same island.
WA4. **ClientRouter lifecycle.** With `<ClientRouter />` (view transitions), page setup
    runs in `document.addEventListener('astro:page-load', …)`, never `DOMContentLoaded`
    or top-level code that assumes a fresh document; listeners and timers added per page
    are removed on `astro:before-swap`; the theme is re-applied on `astro:after-swap` to
    avoid a flash; `transition:persist` only on elements that must survive navigation
    (players, persistent heroes). Why: client-side navigation does not reload scripts, so
    setup code silently stops running or runs twice. Check: when `ClientRouter` is used,
    Grep `DOMContentLoaded` in `src/` → none; each `addEventListener` in page scripts has a
    matching removal.
WA5. **Prefetch and cache headers.** Internal links prefetch (`prefetch` enabled, hover or
    viewport strategy); hashed assets under `/_astro/` are served
    `Cache-Control: public, max-age=31536000, immutable`; HTML is `no-cache` (public pages
    may add a short `s-maxage`); authenticated pages and API responses are never stored
    by shared caches. Why: instant navigation without stale HTML or leaked private pages.
    Check: the host's headers config contains the rules; `curl -sI` on a page and on an
    `/_astro/` asset of the build shows them.
WA6. **SEO-first public pages.** Every public page has a unique `<title>` ≤ 60 chars, a
    meta description of 100–155 chars, a canonical URL (`site` set in the Astro config),
    Open Graph and Twitter tags, JSON-LD for its page type, exactly one `h1`, and `lang`
    set to the page locale; `@astrojs/sitemap` and `robots.txt` exist (`llms.txt` when the
    project publishes one); private and auth pages are `noindex, follow` and excluded from
    the sitemap; localized routes declare reciprocal `hreflang` plus `x-default` and never
    auto-redirect by IP or `Accept-Language`. Titles and descriptions come from i18n.
    Why: these pages exist to be found. Check: after `{{commands.web.build}}`, scan
    `dist/**/*.html` of public routes for title length, description length, canonical,
    one `h1`, and JSON-LD that parses.
WA7. **Typed `astro:env`.** Configuration is declared in `astro.config.*`
    `env.schema` with `envField` (`context: 'client', access: 'public'` for browser values
    such as `PUBLIC_API_URL`; `context: 'server', access: 'secret'` for secrets) and read
    from `astro:env/client` / `astro:env/server`; app code never reads
    `import.meta.env.<NAME>` for configuration, and client code never reads
    `process.env`. Why: a typed schema fails the build on a missing variable and keeps
    secrets out of client bundles. Check: Grep `import\.meta\.env\.` in `src/` and confirm
    only framework flags (`DEV`, `PROD`, `MODE`, `SSR`, `BASE_URL`, `SITE`); Grep
    `process\.env` in `.tsx` → none.
WA8. **HeroUI v3.** `@heroui/react` with `@heroui/styles` imported after `tailwindcss` in
    the global CSS; no `HeroUIProvider`, no `@heroui/theme`, no v2 APIs: Button uses
    `variant` (not `color`) and `onPress` (not `onClick`); `isLoading` does not exist (use
    `isDisabled` plus a spinner or pending label); `Input` takes no `label` (the field
    wrapper composes `TextField` + `Label` + `Input`); `useDisclosure` is a local hook;
    `Switch` needs `Switch.Control` + `Switch.Thumb` (use the toggle wrapper); a
    controlled modal without a trigger controls `Modal.Backdrop` (`isOpen`,
    `onOpenChange`) instead of a `<Modal>` root; never HeroUI's `<Form>`; every react-aria
    control (Select, ComboBox, icon-only Button) has an accessible name. HeroUI CSS
    variables (`--accent`, `--surface`, `--field-background`, `--danger`, …) are mapped to
    project tokens in the global CSS. When unsure of an API, read the installed types in
    `node_modules/@heroui/react`. Why: v2 habits compile and then render broken or warn
    at runtime. Check: Grep
    `HeroUIProvider|@heroui/theme|<Button[^>]*\b(color=|isLoading|onClick=)|<Form[\s>]`
    in `.tsx` → none; the console shows no `PressResponder` or `aria-label` warnings.
WA9. **Tailwind v4 canonical classes.** CSS-first configuration (`@import "tailwindcss"`
    and `@theme` tokens in the global CSS). No v3 names (`bg-gradient-to-*` →
    `bg-linear-to-*`, `flex-shrink-0` → `shrink-0`, `flex-grow` → `grow`,
    `overflow-ellipsis` → `text-ellipsis`, `break-words` → `wrap-break-word`); no arbitrary
    value that exists in the scale (px ÷ 4: `min-h-[300px]` → `min-h-75`,
    `aspect-[3/4]` → `aspect-3/4`); brackets only for `calc()`, `var()`, `%`, viewport
    units, `deg`, `ch` and off-scale ratios; canonical state variants (`data-hovered:`,
    `data-selected:`); a component's own size lives outside theme namespaces
    (`--bottom-nav-height` + `var()`), so it never becomes a spacing token. Names v4
    reused with new values (`shadow-sm`, `rounded-sm`, `blur-sm`, `outline-none`) are not
    replaced blindly. Why: the build and most linters accept v3 names silently. Check:
    lint with `better-tailwindcss/enforce-canonical-classes` (or the project's canonical
    class check) exits 0; Grep `bg-gradient-to-|flex-shrink-|flex-grow|overflow-ellipsis|-\[\d+px\]`
    → none.
WA10. **Dev server and build hygiene.** `vite.optimizeDeps.include` lists every heavy
    dependency islands import (react, react-dom/client, the JSX runtimes,
    `@heroui/react`, `@tanstack/react-query`, zustand, sonner, the HTTP client,
    react-hook-form, `@hookform/resolvers/zod`, zod), so the dev server never
    re-optimizes mid-session ("504 Outdated Optimize Dep"); the dev toolbar is disabled;
    `astro check` / `astro build` never run against the same `node_modules/.vite` as a
    running dev server (type-check with `tsc --noEmit` meanwhile, and never delete `.vite`
    under a live server). Islands stay small (vendor chunks split, each chunk < 500 kB);
    images use `astro:assets` or explicit `width`/`height`; fonts are self-hosted or
    preconnected with `display=swap`. Why: these break hydration in dev and Core Web
    Vitals in production. Check: inspect `astro.config.*`; the build output has no chunk
    warning.
WA11. **Auth in static builds.** Prerendered HTML never contains private data:
    authenticated screens are `client:only` islands behind the session gate, which
    bootstraps the session once (refresh single-flight) and redirects to the sign-in route
    without one; SSR routes (`prerender = false`) check the session in
    `src/middleware.ts`; private pages are `noindex`. Why: static HTML is public by
    construction. Check: Grep private pages for `client:only` roots and `noindex`; the
    built HTML of private routes contains only skeletons.
<!-- /kit:block web-astro -->
