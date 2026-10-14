# Data layer: services, queries, mutations, errors, tests

Enforces W4, W5, W6, W11, W13, W15 (and MO1 when the project has the money add-on).
Templates: `apiClient.ts`, `endpoints.ts`, `queryClient.ts`, `sonnerResponse.ts`,
`translateError.ts`, `toastApiError.ts`.

## 1. Flow

```text
read : component -> feature hook -> use<X>Query (tanstack-queries/) -> service -> apiClient -> API
write: component -> feature hook -> use<X>Mutation (mutations/)   -> service -> apiClient -> API
                                      onSuccess: toast + invalidate *_KEY
                                      onError:   toastApiError(error, fallbackKey)
```

- Components never call services, `useQuery` or `useMutation`; they get data and callbacks from
  their feature hook (W2).
- Hooks never call a service directly for a write; they call a mutation.
- Nothing outside `services/` touches `apiClient`; nothing builds URLs outside `endpoints.ts`.

## 2. Assumed API contract

Adapt it once, in the services, if the API differs.

- Success: the resource DTO, or `{ items: Dto[], total: number }` for paginated lists.
- Error: `{ code: string, message?: string, details?: unknown }`. The client reads `code` only (W6).
- Money: decimal strings (`"1234.50"`) with the currency beside them.
- Auth: `POST /auth/refresh` reads the httpOnly refresh cookie and returns `{ accessToken, user }`
  (routing-and-auth.md).

## 3. Services (W1)

One function per endpoint, plus the DTO <-> domain mapping. Services are isomorphic: `.astro`
frontmatter can call them at build or request time.

```ts
// src/app/features/users/services/usersService.ts
import { apiClient } from '@/app/api/apiClient'
import { API_ENDPOINTS } from '@/app/api/endpoints'
import type { User, UserDto, UserInput, UsersPage, UsersPageDto, UsersParams } from '../types'

const toUser = (dto: UserDto): User => ({
  id: dto.id,
  name: dto.name,
  email: dto.email,
  role: dto.role,
  isActive: dto.isActive,
  createdAt: new Date(dto.createdAt),
})

export async function getAdminUsers(params: UsersParams): Promise<UsersPage> {
  const { data } = await apiClient.get<UsersPageDto>(API_ENDPOINTS.users.adminList, { params })
  return { items: data.items.map(toUser), total: data.total }
}

export async function createUser(input: UserInput): Promise<User> {
  const { data } = await apiClient.post<UserDto>(API_ENDPOINTS.users.list, input)
  return toUser(data)
}

export async function setUserActive({ id, isActive }: { id: string; isActive: boolean }): Promise<User> {
  const { data } = await apiClient.patch<UserDto>(API_ENDPOINTS.users.status(id), { isActive })
  return toUser(data)
}
```

- **Never catch to rethrow** `new Error(response.data.message)`: that throws away the code the
  mutation needs (W6). Errors propagate as `AxiosError`.
- No `baseURL` in services; the client has it (`env.apiUrl`).
- Partial payloads: if the API may omit a field, the DTO type says so (`totals?: TotalsDto`) and
  the mapper fills the default (`ordersCount: dto.totals?.ordersCount ?? 0`). Components then
  read the domain type without `?.`. A thin payload must not crash an island (there is no error
  boundary); a test feeds the mapper a payload without the optional parts.

## 4. Shared queries (W4)

One file per domain in `src/app/tanstack-queries/`, exporting the key constant and the hooks.

```ts
// src/app/tanstack-queries/usersQuery.ts
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getAdminUsers } from '@/app/features/users/services/usersService'
import type { UsersParams } from '@/app/features/users/types'

export const USERS_KEY = 'users'

export function useAdminUsersQuery(params: UsersParams) {
  return useQuery({
    queryKey: [USERS_KEY, 'admin', params],
    queryFn: () => getAdminUsers(params),
    placeholderData: keepPreviousData,
  })
}
```

- `queryKey` always starts with the exported `*_KEY`; mutations invalidate with
  `{ queryKey: [USERS_KEY] }` (prefix match covers every page and filter). A literal `['users']`
  typed twice drifts silently on the first rename.
- Never call `useQuery` with the same key inside a feature; use the shared hook.
- Skeletons are gated by `isLoading` (first load, no data). `isFetching` drives at most a subtle
  "refreshing" hint; with `keepPreviousData` the table keeps its rows while the next page loads.
- Every screen renders the four states (W13): loading (skeleton), error (message + retry),
  empty (empty state with a next action), data.
- Private data waits for the session: `enabled: status === 'authenticated'`
  (`useAuthStore((state) => state.status)`).
- `refetch` never rejects (errors land in the query state), so `onRetry={query.refetch}` is safe.

## 5. Mutations (W4, W5, W6)

`mutations/use<Feature>Mutations.ts`, one exported hook per mutation:

```ts
// src/app/features/users/mutations/useUsersMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/app/i18n'
import { sonnerResponse } from '@/app/helpers/sonnerResponse'
import { toastApiError } from '@/app/helpers/toastApiError'
import { USERS_KEY } from '@/app/tanstack-queries/usersQuery'
import { createUser, setUserActive } from '../services/usersService'

export function useCreateUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      sonnerResponse(t('users.toast.created'), 'success')
      return queryClient.invalidateQueries({ queryKey: [USERS_KEY] })
    },
    onError: (error) => toastApiError(error, 'users.toast.createFailed'),
  })
}

export function useSetUserActiveMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setUserActive,
    onSuccess: () => {
      sonnerResponse(t('users.toast.statusChanged'), 'success')
      return queryClient.invalidateQueries({ queryKey: [USERS_KEY] })
    },
    onError: (error) => toastApiError(error, 'users.toast.statusFailed'),
  })
}

```

The full file, with update and delete, is in `feature-implementation.md` §5.

- `mutationFn` calls the service and nothing else.
- `onSuccess` toasts with `sonnerResponse(t(...), 'success')` and RETURNS the invalidation
  promise: the mutation stays pending until the list is fresh, and no promise floats.
- `onError` is always `toastApiError(error, '<feature>.toast.<action>Failed')`. Never
  `toast.error('...')`, never the backend message.
- `useQueryClient()`, not the imported singleton, so tests can provide their own client.
- Dialogs close in the per-call `onSuccess` the hook passes: `mutate(values, { onSuccess: dialog.onClose })`.
  Never in `onSettled` (it would also close on error and drop what the user typed).
- Full-page forms (sign-up, checkout) navigate after success (`navigate()` from
  `astro:transitions/client`) instead of rendering an inline success block.
- Toasts live in mutations only. Validation errors render under their fields; no
  `window.alert/confirm/prompt` anywhere (destructive actions use `ConfirmDialog`).

## 6. Errors by code (W6)

`translateError(code)` maps an API code to `errors.<code>` (unknown code -> `errors.unknown`).
`toastApiError(error, fallbackKey)` shows `t(translateError(code))`, or `t(fallbackKey)` when the
error carries no code (offline, timeout). The backend `message` is never shown and never compared.

When a code belongs to a field, the form hook also marks that field, so the message sits next
to the input that must change:

```ts
// inside useUserForm: the per-call onError runs after the mutation's own onError (the toast)
createUser.mutate(values, {
  onSuccess: onDone,
  onError: (error) => {
    if (getApiErrorCode(error) === 'user.email-taken') {
      form.setError('email', { message: 'errors.user.email-taken' })
    }
  },
})
```

Field errors hold i18n keys; `FormField` renders `t(key)`.

## 7. Money (W11; MO1 with the money add-on)

Amounts arrive as decimal strings. Display with `Intl.NumberFormat`; do arithmetic only through
the project's decimal helper; never `.toFixed()` / `+` / `*` on the raw value (a string has no
`toFixed`, and floats lose cents).

```ts
// src/app/helpers/money.ts
import type { Locale } from '@/app/i18n'

/** A decimal exactly as the API sends it: "1234.50". */
export type DecimalString = string

const formatters = new Map<string, Intl.NumberFormat>()

/** Display only: Number() keeps 15 significant digits, enough to show, never used for math. */
export function formatMoney({ amount, currency, locale }: { amount: DecimalString; currency: string; locale: Locale }): string {
  const cacheKey = `${locale}|${currency}`
  let formatter = formatters.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
    formatters.set(cacheKey, formatter)
  }
  return formatter.format(Number(amount))
}
```

```ts
// arithmetic through a decimal library (big.js here), rounded once at the end
import Big from 'big.js'

export const sumLines = (lines: ReadonlyArray<{ unitPrice: DecimalString; quantity: number }>): DecimalString =>
  lines.reduce((total, line) => total.plus(new Big(line.unitPrice).times(line.quantity)), new Big(0)).toFixed(2)
```

- The currency comes with the amount, or from the project's config in single-currency apps.
- Amount inputs are text with `inputMode="decimal"`, never `type="number"`. Empty is not zero:
  the schema rejects a blank amount instead of defaulting it. Comma decimals and pasted
  thousands separators go through one shared parser (W11).

## 8. Admin CRUD list (recommended pattern)

For admin tables with inline toggles:

- A dedicated admin endpoint (`/users/admin`) that returns every row regardless of status, with a
  stable `orderBy createdAt asc` and no caching headers.
- Inline `ToggleSwitch` -> simple mutation -> `onSuccess` invalidates the key.
- No optimistic `onMutate` / `setQueryData` for toggles: with a stable order the refetch is
  invisible, and the code stays one shape. Ordering by the toggled field (`isActive desc`) makes
  rows jump under the cursor.

## 9. Testing (W15)

Vitest + React Testing Library. Tests assert behaviour a user or a caller can observe.

```ts
// vitest.config.ts: getViteConfig brings Astro's aliases and virtual modules (astro:env)
/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config'

export default getViteConfig({
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
})
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
```

Rules:

- **Mock at the service boundary** (`vi.mock('../services/usersService')`): hooks, mutations,
  queries, providers and the toaster run for real (FT22).
- **Providers are real**: a fresh `QueryClient` per test (retries off) inside a real
  `QueryClientProvider`, plus a real `<Toaster />` when toasts are asserted.
- **Invalidation is proven by its effect** with the exported key (FT9): seed the query with the
  real key shape, run the mutation, assert `isInvalidated`.
- **Error shapes come from the library** (FT18): build a real `AxiosError` with a response.
- **Stubs render a `data-testid`** (FT8), never `null`.

```tsx
// src/app/features/users/__tests__/useUsersMutations.test.tsx
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { Toaster } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getT } from '@/app/i18n'
import { USERS_KEY } from '@/app/tanstack-queries/usersQuery'
import { useCreateUserMutation } from '../mutations/useUsersMutations'
import { createUser } from '../services/usersService'
import type { UserInput } from '../types'

vi.mock('../services/usersService')

const t = getT('en')
const LIST_KEY = [USERS_KEY, 'admin', { page: 1, pageSize: 10 }]
const INPUT: UserInput = { name: 'Ada', email: 'ada@example.test', role: 'member', password: 'long-enough-9' }

function apiError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config,
  })
}

function renderCreateMutation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
  return { queryClient, ...renderHook(() => useCreateUserMutation(), { wrapper }) }
}

describe('useCreateUserMutation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('invalidates the users list and confirms with a toast', async () => {
    vi.mocked(createUser).mockResolvedValue({
      id: 'u-2', name: 'Ada', email: 'ada@example.test', role: 'member', isActive: true, createdAt: new Date(0),
    })
    const { queryClient, result } = renderCreateMutation()
    queryClient.setQueryData(LIST_KEY, { items: [], total: 0 })

    result.current.mutate(INPUT)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryState(LIST_KEY)?.isInvalidated).toBe(true)
    expect(await screen.findByText(t('users.toast.created'))).toBeInTheDocument()
  })

  it('shows the translated error code and never the backend message', async () => {
    vi.mocked(createUser).mockRejectedValue(apiError(409, { code: 'user.email-taken', message: 'backend text' }))
    const { result } = renderCreateMutation()

    result.current.mutate(INPUT)

    expect(await screen.findByText(t('errors.user.email-taken'))).toBeInTheDocument()
    expect(screen.queryByText('backend text')).not.toBeInTheDocument()
  })
})
```

Component specs render the island root (real `AppProviders`), mock the service, stub heavy
children with a test id, and assert what the user sees:

```tsx
vi.mock('../components/UsersTable', () => ({ default: () => <div data-testid="users-table" /> }))
```

Hydration specs for islands that render server-side follow FT10: `renderToString` +
`hydrateRoot` with `onRecoverableError`, zero recoverable errors.
