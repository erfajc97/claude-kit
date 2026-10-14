# Routing, navigation and auth

Enforces WA2, WA4, WA5, WA6 (private pages), WA7, WA11 and W14. Templates: `middleware.ts`,
`apiClient.ts`, `authStore.ts`, `BaseLayout.astro`, `astro.config.mjs`.

## 1. Routes are files in `src/pages/`

```text
src/pages/
├── index.astro              # /
├── catalog.astro            # /catalog
├── products/[slug].astro    # /products/:slug (getStaticPaths)
├── checkout.astro           # /checkout (prerender = false: on demand)
├── sign-in.astro            # /sign-in (public, noindex)
├── account/index.astro      # /account (private: client-only gated island)
├── admin/users.astro        # /admin/users (private)
├── robots.txt.ts            # endpoint (landing.md)
├── 404.astro
└── es/...                   # other locales when the URL decides the locale
```

- A page composes: layout + frontmatter data + static markup + islands. The content comes from
  `features/` and `app/components/`; a page holds no business logic.
- Slugs are in the site's primary language; other locales live under their prefix. Links between
  locales use `getRelativeLocaleUrl(locale, path)` from `astro:i18n`.

## 2. Static, dynamic and on-demand pages

Static is the default (`output: 'static'`). Dynamic routes list their paths at build time and
hand the fetched data to the page as props, so it is fetched once:

```astro
---
// src/pages/products/[slug].astro
import type { GetStaticPaths, InferGetStaticPropsType } from 'astro'
import Product from '@/app/features/product/Product'
import ProductGallery from '@/app/features/product/components/ProductGallery.astro'
import { getPublishedProducts } from '@/app/features/product/services/productsService'
import { getT, resolveLocale } from '@/app/i18n'
import PublicLayout from '@/layouts/PublicLayout.astro'

export const getStaticPaths = (async () => {
  const products = await getPublishedProducts()
  return products.map((product) => ({ params: { slug: product.slug }, props: { product } }))
}) satisfies GetStaticPaths

type Props = InferGetStaticPropsType<typeof getStaticPaths>

const { product } = Astro.props
const locale = resolveLocale(Astro.currentLocale)
const t = getT(locale)
---
<PublicLayout title={t('product.meta.title', { name: product.name })} description={product.summary} locale={locale}>
  <ProductGallery images={product.images} name={product.name} />
  <Product client:visible product={product} locale={locale} />
</PublicLayout>
```

- Services are isomorphic: the frontmatter calls them at build time (or per request on demand).
- Pages that need per-request data (checkout, a live dashboard) opt out of prerendering with
  `export const prerender = false`; that needs an adapter. Everything else stays static.
- Private data is never fetched in frontmatter of a prerendered page: it would be baked into
  public HTML (WA11).

## 3. ClientRouter lifecycle (WA4)

`<ClientRouter />` (in `BaseLayout`) turns navigations into DOM swaps with view transitions.

| Event | When | Use it to |
|---|---|---|
| `astro:before-preparation` | a navigation starts | show a progress indicator |
| `astro:after-preparation` | the next page is loaded, before the swap | hide the indicator |
| `astro:before-swap` | just before the swap (`event.newDocument`) | adjust the incoming document |
| `astro:after-swap` | right after the swap, before paint | re-apply `<html>` attributes (theme) |
| `astro:page-load` | after the first load and after every navigation | (re)bind bundled scripts |

- Bundled `<script>` tags run once per visit. Code that touches page elements binds inside an
  `astro:page-load` listener, or it stops working after the first navigation.
- An `is:inline` script that must run on every navigation gets `data-astro-rerun`.
- `transition:persist` keeps an element or island alive across navigations: the header island
  (and with it the page's Toaster), a playing video, an open mini cart.
- The QueryClient singleton and every Zustand store survive navigations; a full reload resets them.
- `data-astro-reload` on a link forces a full page load (sign-out landing, links outside the app).
- Programmatic navigation: `navigate(href)` from `astro:transitions/client`.
- Data islands in this mode use `client:only="react"` + `.astro` fallback (heroui-v3.md §7).

## 4. Prefetch and caching (WA5)

- `prefetch: { prefetchAll: true, defaultStrategy: 'hover' }` in `astro.config.mjs`.
  Per link: `data-astro-prefetch="viewport" | "load" | "tap" | "false"`. Heavy or rarely visited
  links (exports, huge reports) get `"false"`. Programmatic: `prefetch(url)` from `astro:prefetch`.
- Hashed build assets (`/_astro/*`) are immutable; HTML always revalidates; private on-demand HTML
  is `private, no-store` (set by `middleware.ts`). On hosts that read `public/_headers`:

```text
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

## 5. Auth model (W14, WA11)

| Piece | Where | Rule |
|---|---|---|
| Access token | `useAuthStore` (memory) | short-lived; never in localStorage, sessionStorage or a readable cookie |
| Refresh token | httpOnly cookie set by the API | `Secure`, `SameSite=Lax` or `Strict`, path-scoped; cross-site deployments add CSRF protection on the API |
| Requests | `apiClient` | `withCredentials: true`, `Authorization: Bearer <access token>` |
| Expired token | `apiClient` response interceptor | one refresh shared by all concurrent 401s, then retry once |
| Lost session | same | clear the store, go to `signInHref()` (sign-in with `returnTo`) |
| Reload | session query | one bootstrap refresh per page load |

Why not "secure storage" over localStorage: an AES key shipped in the bundle is public, so any
script on the page (an XSS, a compromised dependency) decrypts the tokens, and a stolen refresh
token works for days. With the access token in memory and the refresh token in an httpOnly
cookie, injected code can act only while the tab is open and cannot take the long-lived secret.

### Session bootstrap

```ts
// src/app/tanstack-queries/sessionQuery.ts
import { useQuery } from '@tanstack/react-query'
import { bootstrapSession } from '@/app/api/apiClient'

export const SESSION_KEY = 'session'

/** Asks the API once per page load whether the refresh cookie still holds a session. */
export function useSessionBootstrap() {
  return useQuery({
    queryKey: [SESSION_KEY],
    queryFn: bootstrapSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
}
```

Every island that depends on the session (header auth area, gated islands) calls it; the
singleton QueryClient makes it one request. `useAuthStore((state) => state.status)` is
`unknown` until it answers, then `authenticated` or `anonymous`. A network failure leaves the
query in error: show the error state with retry, never "signed out".

### Gated islands (WA11)

The HTML of a prerendered page is public. Private pages ship only a static shell (heading,
skeleton) plus a `client:only="react"` island wrapped in `AuthGate`; private data is fetched by
that island after the session is known, and private queries use
`enabled: status === 'authenticated'`. Private pages also pass `noindex` to the layout.

```tsx
// src/app/components/AuthGate.tsx
import type { ReactNode } from 'react'
import { ErrorState } from '@/app/components/UI/ErrorState'
import { TableSkeleton } from '@/app/components/UI/TableSkeleton'
import { useT } from '@/app/i18n'
import { useAuthStore, type UserRole } from '@/app/store/auth/authStore'
import { useSessionBootstrap } from '@/app/tanstack-queries/sessionQuery'
import { Forbidden } from './Forbidden'
import { SignInRequired } from './SignInRequired'

interface AuthGateProps {
  children: ReactNode
  requiredRole?: UserRole
  fallback?: ReactNode
}

/** UX gate only: the API authorizes every request regardless of what the UI shows. */
export function AuthGate({ children, requiredRole, fallback }: AuthGateProps) {
  const t = useT()
  const session = useSessionBootstrap()
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.user?.role)

  if (status === 'unknown' && session.isError) {
    return <ErrorState message={t('auth.sessionCheckFailed')} onRetry={session.refetch} />
  }
  if (status === 'unknown') return fallback ?? <TableSkeleton label={t('common.loading')} />
  if (status === 'anonymous') return <SignInRequired />
  if (requiredRole && role !== requiredRole) return <Forbidden />
  return children
}
```

```tsx
// src/app/components/SignInRequired.tsx
import { Button } from '@heroui/react'
import { signInHref } from '@/app/api/apiClient'
import { EmptyState } from '@/app/components/UI/EmptyState'
import { useT } from '@/app/i18n'

export function SignInRequired() {
  const t = useT()
  // Reads the current URL at event time, never during render (WA2).
  const goToSignIn = () => window.location.assign(signInHref())
  return (
    <EmptyState
      title={t('auth.required.title')}
      body={t('auth.required.body')}
      action={<Button variant="primary" onPress={goToSignIn}>{t('auth.signIn')}</Button>}
    />
  )
}
```

`Forbidden` has the same shape with a link home. Role checks in the UI hide what the user cannot
use; they protect nothing.

### On-demand private routes

`src/middleware.ts` (template) runs for `prerender = false` pages: it redirects to sign-in when
no session hint cookie reaches the server, and marks the response `noindex` + `private, no-store`.
The hint only exists when the browser sends the API's cookie to the web server (same site, cookie
scoped to the parent domain). Without it, keep private pages static and client-gated. Never trust
the hint for data: the API decides.

## 6. Sign in, sign out

Two valid shapes; pick one per project:

- **Dialog**: the header island (`features/auth/Auth.tsx`) owns a `useDisclosure`, renders the
  sign-in trigger and the `SignInDialog`. `SIGN_IN_PATH` then points at a page that opens the
  dialog (or at a small dedicated page) so 401 redirects still have a target.
- **Page**: `src/pages/sign-in.astro` renders the `sign-in` feature island; the header island
  only links to it.

```ts
// src/app/features/auth/mutations/useAuthMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/app/i18n'
import { sonnerResponse } from '@/app/helpers/sonnerResponse'
import { toastApiError } from '@/app/helpers/toastApiError'
import { useAuthStore } from '@/app/store/auth/authStore'
import { signIn, signOut } from '../services/authService'

export function useSignInMutation() {
  return useMutation({
    mutationFn: signIn, // POST /auth/sign-in -> { accessToken, user }; the API sets the refresh cookie
    onSuccess: (session) => {
      useAuthStore.getState().setSession(session)
      sonnerResponse(t('auth.toast.signedIn'), 'success')
    },
    onError: (error) => toastApiError(error, 'auth.toast.signInFailed'),
  })
}

export function useSignOutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: signOut, // POST /auth/sign-out: the API clears the refresh cookie
    onSuccess: () => {
      useAuthStore.getState().clearSession()
      queryClient.clear() // drop every cached private response
      sonnerResponse(t('auth.toast.signedOut'), 'success')
    },
    onError: (error) => toastApiError(error, 'auth.toast.signOutFailed'),
  })
}
```

After sign-in the hook closes the dialog (`{ onSuccess: dialog.onClose }`) or navigates to the
validated `returnTo`. `returnTo` comes from the query string, so it is attacker-controlled: accept
only same-site paths.

```ts
// src/app/features/auth/helpers/safeReturnTo.ts
/**
 * Same-site paths only. "/account?tab=2" passes; absolute URLs, protocol-relative "//host" and a
 * backslash right after the first slash (browsers read it as "//") fall back to "/".
 */
export function safeReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}
```

The header auth area renders a fixed-size placeholder while the status is `unknown` (no layout
shift), the sign-in action when `anonymous`, and the account menu when `authenticated`.
