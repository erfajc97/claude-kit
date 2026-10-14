# Project structure

Where code lives in an Astro + React islands project, and why. Enforces W1, W2, W3, W12 and
WA1, WA2, WA3. The worked example of a full feature is `feature-implementation.md`.

## 1. Top level

```text
src/
├── pages/                  # file-based routing: layout + static content + islands
├── layouts/                # BaseLayout.astro (html shell, SEO, theme), PublicLayout.astro
├── middleware.ts           # checks for on-demand (SSR) routes only (WA11)
├── styles/global.css       # design tokens: the only file with literal colors (W8)
├── assets/
│   ├── svg/                # one icon component per file (icons-and-assets.md)
│   └── images/             # processed by astro:assets
└── app/
    ├── api/                # apiClient.ts (axios + refresh), endpoints.ts
    ├── config/             # env.ts (typed public config, WA7)
    ├── i18n/               # t, useT, getT + locales/<code>.ts (W12)
    ├── lib/                # queryClient.ts (singleton, W4)
    ├── providers/          # AppProviders.tsx: wraps every island root (WA3)
    ├── store/              # Zustand stores: the only state shared across islands (WA3)
    ├── tanstack-queries/   # <domain>Query.ts: *_KEY + use<X>Query (W4)
    ├── components/UI/      # wrappers over HeroUI (W7), unless the project has its own UI package
    ├── components/         # app-wide pieces: AuthGate.tsx, skeletons/*.astro, ThemeToggle.astro
    ├── hooks/              # app-wide hooks: useDisclosure, useHydrated, useDebouncedValue
    ├── helpers/            # app-wide helpers: sonnerResponse, translateError, toastApiError, money, theme
    ├── types/              # types used by more than one feature
    └── features/<feature>/ # see §2
```

- `pages/` only composes. Content and behaviour come from `features/` and `components/`.
- `app/` is framework-agnostic React + TypeScript; `.astro` files live in `pages/`, `layouts/`,
  feature `components/` (static pieces) and `app/components/skeletons/`.

## 2. Feature folder (W1)

```text
src/app/features/<feature>/
├── <Feature>.tsx        # the ONE island root, named after the entity (Users.tsx, Cart.tsx)
├── components/          # dumb UI, 1 file = 1 component (.tsx or static .astro)
├── hooks/               # all logic: state, derived data, handlers, orchestration
├── mutations/           # use<Feature>Mutations.ts: one exported hook per mutation
├── services/            # one function per endpoint + DTO <-> domain mapping
├── helpers/             # pure functions, no React, no I/O
├── __tests__/           # specs of hooks, mutations, services, helpers, components
├── types.ts             # every type of the feature (DTOs, domain, params, props shared by files)
├── data.ts              # static data: table columns, options, nav items (keys, not copy)
└── schema.ts            # zod schemas of the feature's forms, and nothing else
```

Rules:

- **No cross-feature imports.** Something two features need moves up: `app/components`,
  `app/hooks`, `app/helpers`, `app/types`, `app/store` or `app/tanstack-queries`.
- **Queries are app-level** (`src/app/tanstack-queries/`), so every feature reads the same
  `*_KEY` and the same fetcher (data-layer.md).
- **One component per file**, no inner `function Row()` next to the exported one. Sub-pieces get
  their own file in `components/`.
- **Dumb components (W2)**: props in, JSX out. A component may call ONE hook of its feature that
  returns everything it renders (`const page = useUsersPage()`); it never calls services,
  `useQuery`/`useMutation`, or holds business rules.
- **Hooks hold the logic**: they compose the shared query, the mutations, local state and
  handlers, and return plain values and callbacks.
- **`types.ts`** is the single home of the feature's types; services, hooks and components import
  from `../types`. A type shared with another feature moves to `src/app/types/`.

Folders that a feature does not need are not created.

## 3. Island roots (WA3)

Each island is a separate React tree: no provider is shared between islands. The root therefore
mounts `AppProviders` itself and renders one screen component inside it (hooks need the
providers above them, so the root cannot call them).

```tsx
// src/app/features/users/Users.tsx
import AppProviders, { type IslandProps } from '@/app/providers/AppProviders'
import UsersScreen from './components/UsersScreen'

export default function Users(props: IslandProps) {
  return (
    <AppProviders {...props}>
      <UsersScreen />
    </AppProviders>
  )
}
```

- **One QueryClient** for the page: `src/app/lib/queryClient.ts` is a module singleton, so every
  island shares one cache (and with ClientRouter, one cache per visit).
- **One Toaster** per page: only the island that receives `withToaster` renders it. On public
  pages it is the header island in `PublicLayout`; on app pages, the page's main island.
- **Cross-island state is Zustand.** React Context does not cross islands. Context is fine
  INSIDE one island (AppProviders uses it for the locale).

## 4. `.astro` or `.tsx` (WA1, WA2)

Astro first: anything without state, events or effects is `.astro` and ships zero JS (headers,
footers, heroes, listings, copy, static dashboards, skeletons). React only for forms, dialogs,
filters, live data, carts. Each island adds its own JS; use them with discipline. Pass data from
the page's frontmatter as props instead of fetching on the client when the page can render it.

| Directive | When |
|---|---|
| none | `.astro` component, or a React component rendered to static HTML (no interactivity) |
| `client:visible` | default for interactive islands below the fold |
| `client:idle` | above the fold, needed soon but not on the first frame (header actions) |
| `client:load` | interactive on the first frame and above the fold; justify it in review |
| `client:only="react"` | islands that render private or query data in a static build with ClientRouter; always with an `.astro` skeleton in `slot="fallback"` |

```astro
<Users client:only="react" locale={locale}>
  <TableSkeleton slot="fallback" label={t('common.loading')} />
</Users>
```

Never read `window`, `document`, `localStorage` or cookies during the first render of a
server-rendered island: the server cannot, so the HTML and the first client render differ.
Gate such reads behind `useHydrated()` (§9) or move them to an event handler.

## 5. There is no SPA bootstrap

| SPA (Vite + router) | Astro |
|---|---|
| `main.tsx` + `RouterProvider` | none: routing is `src/pages/` |
| root route with global providers | `BaseLayout.astro` (shell) + `AppProviders` inside each island root |
| `HeroUIProvider` | not used in HeroUI v3; theme through `data-theme` on `<html>` |
| a toast provider at the root | sonner `<Toaster>` through `<AppProviders withToaster>`, one per page |
| Context shared by the app | Zustand stores (`app/store/`) |
| authenticated layout route / `beforeLoad` | client-only gated islands + `src/middleware.ts` for SSR routes (routing-and-auth.md) |
| not-found component | `src/pages/404.astro`, static, `noindex` |

```astro
---
// src/pages/404.astro
import BaseLayout from '@/layouts/BaseLayout.astro'
import { getT, resolveLocale } from '@/app/i18n'

const locale = resolveLocale(Astro.currentLocale)
const t = getT(locale)
---
<BaseLayout title={t('notFound.meta.title')} description={t('notFound.meta.description')} locale={locale} noindex>
  <main class="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
    <h1 class="text-4xl font-semibold text-fg">{t('notFound.title')}</h1>
    <a href="/" class="text-accent underline underline-offset-4">{t('notFound.backHome')}</a>
  </main>
</BaseLayout>
```

## 6. Zustand stores (WA3)

- One store per concern in `src/app/store/<concern>/<concern>Store.ts` (`authStore`, `cartStore`).
- Stores hold CLIENT state. Server state lives in TanStack Query (W4); a store never caches API
  lists.
- Secrets never persist (W14): the auth store is memory-only (`templates/authStore.ts`).
- A persisted store (cart lines, UI preferences) uses `persist` with `skipHydration: true` and
  calls `useXStore.persist.rehydrate()` after hydration, from the island's mount gate. Without
  `skipHydration`, the store reads localStorage at creation and the first client render differs
  from the server HTML (WA2).
- Ephemeral UI state (a dialog open, a hovered row) stays in the component that owns it
  (`useDisclosure`), never in a store.

## 7. i18n layer (W12)

Every visible string goes through the i18n layer: labels, placeholders, `aria-label`, `alt`,
`title`, toasts, empty states, validation messages, page titles and descriptions. Features only
import from `@/app/i18n`; the contract below is what the templates rely on. Any library works if
it is wrapped to expose the same names; this reference has no dependency.

| Export | Use |
|---|---|
| `Locale`, `LOCALES`, `DEFAULT_LOCALE` | the project's locales (same list as `i18n.locales` in `astro.config.mjs`) |
| `MessageKey` | union of every key; `t()` rejects unknown keys at compile time |
| `getT(locale)` | fixed-locale translator: `.astro` frontmatter, tests |
| `useT()` | render-time translator in components and hooks (reads `LocaleContext`) |
| `t(key, params?)` | event-time translator: mutations, toast helpers |
| `LocaleContext`, `setEventLocale` | used only by `AppProviders` |
| `resolveLocale`, `isLocale`, `isMessageKey`, `readStoredLocale` | parsing helpers |

```ts
// src/app/i18n/index.ts
import { createContext, useContext } from 'react'
import en from './locales/en'
import es from './locales/es'

export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/** Keys come from the default locale; every other locale must define all of them. */
export type MessageKey = keyof typeof en
type Params = Record<string, string | number>
export type Translate = (key: MessageKey, params?: Params) => string

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, es }

export const isLocale = (value: unknown): value is Locale => LOCALES.some((locale) => locale === value)
export const resolveLocale = (value: string | undefined): Locale => (isLocale(value) ? value : DEFAULT_LOCALE)
export const isMessageKey = (value: string): value is MessageKey => Object.hasOwn(en, value)

const translators = new Map<Locale, Translate>()

export function getT(locale: Locale): Translate {
  const cached = translators.get(locale)
  if (cached) return cached
  const dictionary = DICTIONARIES[locale]
  const translate: Translate = (key, params) =>
    dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))
  translators.set(locale, translate)
  return translate
}

export const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)
export const useT = (): Translate => getT(useContext(LocaleContext))

let eventLocale: Locale = DEFAULT_LOCALE
export const setEventLocale = (locale: Locale): void => {
  eventLocale = locale
}
export const t: Translate = (key, params) => getT(eventLocale)(key, params)

/** Client only, after hydration: the locale the visitor picked, else the default. */
export function readStoredLocale(): Locale {
  const match = /(?:^|;\s*)locale=([^;]+)/.exec(document.cookie)
  return resolveLocale(match?.[1])
}
```

```ts
// src/app/i18n/locales/en.ts: flat keys; error codes map to `errors.<code>`
const en = {
  'a11y.skipToContent': 'Skip to content',
  'a11y.notifications': 'Notifications',
  'common.cancel': 'Cancel',
  'common.retry': 'Try again',
  'common.loading': 'Loading',
  'common.saving': 'Saving...',
  'validation.required': 'This field is required.',
  'validation.invalid': 'Check this value.',
  'errors.unknown': 'Something went wrong. Please try again.',
  'users.toast.created': 'User created.',
  'users.toast.createFailed': 'The user could not be created.',
} as const satisfies Record<string, string>

export default en

// src/app/i18n/locales/es.ts: `const es: Record<MessageKey, string> = { ... }`
// A missing key is a type error, so no locale can fall behind.
```

Rules:

- A new key goes to EVERY locale file in the same change (the `Record<MessageKey, string>` type
  makes `tsc` fail otherwise).
- `.astro` pages translate in the frontmatter: `const t = getT(resolveLocale(Astro.currentLocale))`.
- Pass `locale` to island roots when the URL decides it (Astro i18n routing). Omit it when a
  stored preference decides on unprefixed URLs; `AppProviders` then renders the default first and
  switches after hydration (the mount gate). URL locales are preferred: `<html lang>`, static
  content and islands then always agree, and search engines get one URL per language.
- Localizable lists (countries, currencies, languages) come from `Intl.DisplayNames`, not from
  hard-coded arrays. Dates, numbers and money go through `Intl` with the active locale.
- Slugs are in the site's primary language; other locales live under a prefix (`/es/...`) with
  reciprocal `hreflang` + `x-default` (BaseLayout `alternates`). Never auto-redirect by IP or
  `Accept-Language`: crawlers come from one country. Suggest the other locale with a banner.

## 8. Theme: light and dark (W8)

- `global.css` defines raw `--ui-*` tokens for `[data-theme="light"]` and `[data-theme="dark"]`,
  exposes them as Tailwind colors in `@theme inline`, and points HeroUI's variables at them.
  Components only use the generated classes (`bg-surface`, `text-fg`, `text-muted`,
  `border-border`, `bg-accent`, `bg-brand-500`); never hex, `oklch()`, `var(--...)` or palette
  classes like `text-white` / `bg-gray-100` in `.tsx` or `.astro`.
- `BaseLayout.astro` sets `data-theme` (and the `dark` class HeroUI also reads) before the first
  paint from the stored choice or `prefers-color-scheme`, and re-applies it on `astro:after-swap`.
- The toggle needs no island: a native button plus a bundled script.

```astro
---
// src/app/components/ThemeToggle.astro
import { getT, type Locale } from '@/app/i18n'
import { MoonIcon } from '@/assets/svg/MoonIcon'
import { SunIcon } from '@/assets/svg/SunIcon'

interface Props {
  locale: Locale
}
const t = getT(Astro.props.locale)
---
<button
  type="button"
  data-theme-toggle
  aria-label={t('theme.toggle')}
  class="inline-flex size-11 items-center justify-center rounded-field text-fg hover:bg-surface-raised"
>
  <MoonIcon className="size-5 dark:hidden" />
  <SunIcon className="hidden size-5 dark:block" />
</button>

<script>
  import { toggleTheme } from '@/app/helpers/theme'

  // Bundled scripts run once per visit; ClientRouter swaps the DOM, so bind on every page load (WA4).
  document.addEventListener('astro:page-load', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', toggleTheme)
    })
  })
</script>
```

```ts
// src/app/helpers/theme.ts
/** Same key as the inline script in BaseLayout.astro. */
export const THEME_STORAGE_KEY = 'theme'

export function toggleTheme(): void {
  const root = document.documentElement
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  root.classList.toggle('dark', next === 'dark')
  root.style.colorScheme = next
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Storage blocked: the choice lasts until the next full page load.
  }
}
```

## 9. `useEffect` is the last resort (W3)

Try these in order and stop at the first that works:

1. **Derive in render**: `const total = items.length` instead of state + effect.
2. **Event handler**: do the work where the user acts (`onPress`, `onSubmit`).
3. **TanStack Query / mutation** for anything that talks to the network. Never network in an effect.
4. **Store persistence** (`persist` middleware) instead of an effect that mirrors to storage.
5. **`key` reset**: `<UserFormDialog key={user?.id ?? 'new'} user={user} />` re-creates the form
   instead of `useEffect(() => setForm(prop), [prop])`, which is banned.
6. **Mount gate** for client-only values:

   ```ts
   // src/app/hooks/useHydrated.ts
   import { useSyncExternalStore } from 'react'

   const subscribe = () => () => {}

   /** false on the server and during hydration, true afterwards. */
   export function useHydrated(): boolean {
     return useSyncExternalStore(subscribe, () => true, () => false)
   }
   ```

7. **An effect with a comment** saying which external system it synchronizes (timer, DOM API,
   subscription, a module outside React), with cleanup:

   ```ts
   // src/app/hooks/useDebouncedValue.ts
   import { useEffect, useState } from 'react'

   export function useDebouncedValue<T>(value: T, delayMs: number): T {
     const [debounced, setDebounced] = useState(value)
     useEffect(() => {
       // Timer: publish the value once typing pauses.
       const timer = setTimeout(() => setDebounced(value), delayMs)
       return () => clearTimeout(timer)
     }, [value, delayMs])
     return debounced
   }
   ```

Effects never live in `components/`; they live in hooks.
