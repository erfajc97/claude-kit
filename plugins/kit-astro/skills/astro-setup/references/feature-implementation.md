# Worked example: an admin CRUD feature

A complete `users` feature for an admin panel: paginated table with search, create/edit dialog,
inline active toggle, delete confirmation. It applies W1-W7, W11-W13, WA2, WA11 and the admin
list pattern of `data-layer.md` §8. Rename the entity; keep the shape.

## Files

```text
src/pages/admin/users.astro                       # page: h1 + client-only island + .astro skeleton
src/app/tanstack-queries/usersQuery.ts            # USERS_KEY + useAdminUsersQuery (data-layer.md §4)
src/app/features/users/
├── Users.tsx                                     # island root: providers + session gate + screen
├── components/
│   ├── UsersScreen.tsx                           # calls useUsersPage(), lays out the pieces
│   ├── UsersTable.tsx                            # loading / error / empty / data states
│   ├── UserCell.tsx                              # one cell per column key
│   ├── UserForm.tsx                              # fields only
│   ├── UserFormDialog.tsx                        # dialog + <form noValidate> + actions
│   └── DeleteUserDialog.tsx                      # ConfirmDialog
├── hooks/
│   ├── useUsersPage.ts                           # orchestration: dialogs, selection, handlers
│   ├── useUsersTable.ts                          # page, search, query
│   └── useUserForm.ts                            # react-hook-form + zod, submit -> mutations
├── mutations/useUsersMutations.ts
├── services/usersService.ts
├── __tests__/
├── types.ts
├── data.ts
└── schema.ts
```

Build order: `types.ts` -> service -> shared query -> mutations -> `schema.ts` -> hooks ->
components -> island root -> page -> tests alongside each step (G2).

## 1. `types.ts`

```ts
import type { UserRole } from '@/app/store/auth/authStore'

export type { UserRole }

export interface UserDto {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: Date
}

export interface UsersPageDto {
  items: UserDto[]
  total: number
}

export interface UsersPage {
  items: User[]
  total: number
}

export interface UsersParams {
  page: number
  pageSize: number
  search?: string
}

export interface UserInput {
  name: string
  email: string
  role: UserRole
  password: string
}

/** Editable after creation. */
export type UserUpdate = Pick<UserInput, 'name' | 'role'>

export type UserColumnKey = 'name' | 'email' | 'role' | 'active' | 'actions'
```

## 2. `schema.ts` (W11)

Limits mirror the API's DTO; inputs reuse the same numbers as `maxLength`. Messages are i18n keys.

```ts
import { z } from 'zod'
import { USER_ROLES } from '@/app/store/auth/authStore'
import type { User } from './types'

export const USER_LIMITS = { nameMax: 100, emailMax: 254, passwordMin: 8, passwordMax: 128 } as const

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(USER_LIMITS.nameMax, 'validation.tooLong'),
  role: z.enum(USER_ROLES, { error: 'validation.required' }),
  email: z.string(),
  password: z.string(),
})

export const userCreateSchema = userUpdateSchema.extend({
  email: z.email({ error: 'validation.email' }).max(USER_LIMITS.emailMax, 'validation.tooLong').toLowerCase(),
  password: z
    .string()
    .min(USER_LIMITS.passwordMin, 'validation.tooShort')
    .max(USER_LIMITS.passwordMax, 'validation.tooLong'),
})

export type UserFormValues = z.infer<typeof userCreateSchema>

export const EMPTY_USER_FORM: UserFormValues = { name: '', email: '', role: 'member', password: '' }

export const toUserFormValues = (user: User): UserFormValues => ({
  name: user.name,
  email: user.email,
  role: user.role,
  password: '',
})
```

## 3. `data.ts`

```ts
import type { DataTableColumn } from '@/app/components/UI/DataTable'
import type { MessageKey } from '@/app/i18n'
import { USER_ROLES } from '@/app/store/auth/authStore'
import type { UserColumnKey } from './types'

export const USER_COLUMNS: ReadonlyArray<Omit<DataTableColumn<UserColumnKey>, 'label'> & { labelKey: MessageKey }> = [
  { key: 'name', labelKey: 'users.columns.name' },
  { key: 'email', labelKey: 'users.columns.email' },
  { key: 'role', labelKey: 'users.columns.role', align: 'center' },
  { key: 'active', labelKey: 'users.columns.active', align: 'center' },
  { key: 'actions', labelKey: 'users.columns.actions', align: 'end' },
]

export const ROLE_OPTIONS = USER_ROLES.map((id) => ({ id, labelKey: `users.roles.${id}` as const }))
```

## 4. `services/usersService.ts`

```ts
import { apiClient } from '@/app/api/apiClient'
import { API_ENDPOINTS } from '@/app/api/endpoints'
import type { User, UserDto, UserInput, UsersPage, UsersPageDto, UsersParams, UserUpdate } from '../types'

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

export async function updateUser({ id, input }: { id: string; input: UserUpdate }): Promise<User> {
  const { data } = await apiClient.patch<UserDto>(API_ENDPOINTS.users.detail(id), input)
  return toUser(data)
}

export async function setUserActive({ id, isActive }: { id: string; isActive: boolean }): Promise<User> {
  const { data } = await apiClient.patch<UserDto>(API_ENDPOINTS.users.status(id), { isActive })
  return toUser(data)
}

export async function deleteUser(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.users.detail(id))
}
```

The shared query `useAdminUsersQuery` is in `data-layer.md` §4.

## 5. `mutations/useUsersMutations.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/app/i18n'
import { sonnerResponse } from '@/app/helpers/sonnerResponse'
import { toastApiError } from '@/app/helpers/toastApiError'
import { USERS_KEY } from '@/app/tanstack-queries/usersQuery'
import { createUser, deleteUser, setUserActive, updateUser } from '../services/usersService'

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

export function useUpdateUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      sonnerResponse(t('users.toast.updated'), 'success')
      return queryClient.invalidateQueries({ queryKey: [USERS_KEY] })
    },
    onError: (error) => toastApiError(error, 'users.toast.updateFailed'),
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

export function useDeleteUserMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      sonnerResponse(t('users.toast.deleted'), 'success')
      return queryClient.invalidateQueries({ queryKey: [USERS_KEY] })
    },
    onError: (error) => toastApiError(error, 'users.toast.deleteFailed'),
  })
}
```

## 6. Hooks

```ts
// hooks/useUsersTable.ts
import { useState } from 'react'
import { useDebouncedValue } from '@/app/hooks/useDebouncedValue'
import { useAdminUsersQuery } from '@/app/tanstack-queries/usersQuery'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

export function useUsersTable() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS)
  const query = useAdminUsersQuery({ page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined })

  const onSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  return {
    users: query.data?.items ?? [],
    totalPages: Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE)),
    page,
    setPage,
    search,
    onSearchChange,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
  }
}
```

```ts
// hooks/useUsersPage.ts
import { useState } from 'react'
import { useDisclosure } from '@/app/hooks/useDisclosure'
import { useDeleteUserMutation, useSetUserActiveMutation } from '../mutations/useUsersMutations'
import type { User } from '../types'
import { useUsersTable } from './useUsersTable'

export function useUsersPage() {
  const table = useUsersTable()
  const formDialog = useDisclosure()
  const deleteDialog = useDisclosure()
  const [selected, setSelected] = useState<User | null>(null)
  // A new key per opening re-creates the form with fresh defaults (W3: key reset, no effect).
  const [formKey, setFormKey] = useState(0)
  const deleteUser = useDeleteUserMutation()
  const setActive = useSetUserActiveMutation()

  const openForm = (user: User | null) => {
    setSelected(user)
    setFormKey((key) => key + 1)
    formDialog.onOpen()
  }

  const askDelete = (user: User) => {
    setSelected(user)
    deleteDialog.onOpen()
  }

  const confirmDelete = () => {
    if (selected) deleteUser.mutate(selected.id, { onSuccess: deleteDialog.onClose })
  }

  return {
    table,
    selected,
    formKey,
    formDialog,
    deleteDialog,
    openCreate: () => openForm(null),
    openEdit: (user: User) => openForm(user),
    askDelete,
    confirmDelete,
    isDeleting: deleteUser.isPending,
    toggleActive: (user: User, isActive: boolean) => setActive.mutate({ id: user.id, isActive }),
    togglingId: setActive.isPending ? setActive.variables.id : null,
  }
}
```

```ts
// hooks/useUserForm.ts
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { getApiErrorCode } from '@/app/helpers/translateError'
import { useCreateUserMutation, useUpdateUserMutation } from '../mutations/useUsersMutations'
import { EMPTY_USER_FORM, toUserFormValues, userCreateSchema, userUpdateSchema, type UserFormValues } from '../schema'
import type { User } from '../types'

export function useUserForm({ user, onDone }: { user: User | null; onDone: () => void }) {
  const createUser = useCreateUserMutation()
  const updateUser = useUpdateUserMutation()
  const schema: z.ZodType<UserFormValues, UserFormValues> = user ? userUpdateSchema : userCreateSchema
  const form = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: user ? toUserFormValues(user) : EMPTY_USER_FORM,
  })

  const markFieldErrors = (error: unknown) => {
    if (getApiErrorCode(error) === 'user.email-taken') {
      form.setError('email', { message: 'errors.user.email-taken' })
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    if (user) {
      updateUser.mutate({ id: user.id, input: { name: values.name, role: values.role } }, { onSuccess: onDone })
      return
    }
    createUser.mutate(values, { onSuccess: onDone, onError: markFieldErrors })
  })

  return {
    control: form.control,
    onSubmit,
    isEdit: user !== null,
    isPending: createUser.isPending || updateUser.isPending,
  }
}
```

## 7. Components (dumb, W2)

```tsx
// components/UsersScreen.tsx
import { Button } from '@heroui/react'
import { SearchField } from '@/app/components/UI/SearchField'
import { useT } from '@/app/i18n'
import { PlusIcon } from '@/assets/svg/PlusIcon'
import { useUsersPage } from '../hooks/useUsersPage'
import DeleteUserDialog from './DeleteUserDialog'
import UserFormDialog from './UserFormDialog'
import UsersTable from './UsersTable'

export default function UsersScreen() {
  const t = useT()
  const page = useUsersPage()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SearchField label={t('users.search.label')} value={page.table.search} onChange={page.table.onSearchChange} />
        <Button variant="primary" onPress={page.openCreate}>
          <PlusIcon className="size-4" />
          {t('users.actions.create')}
        </Button>
      </div>

      <UsersTable
        users={page.table.users}
        page={page.table.page}
        totalPages={page.table.totalPages}
        onPageChange={page.table.setPage}
        isLoading={page.table.isLoading}
        isError={page.table.isError}
        onRetry={page.table.retry}
        togglingId={page.togglingId}
        onEdit={page.openEdit}
        onDelete={page.askDelete}
        onToggleActive={page.toggleActive}
      />

      <UserFormDialog
        key={page.formKey}
        user={page.selected}
        isOpen={page.formDialog.isOpen}
        onOpenChange={page.formDialog.onOpenChange}
        onDone={page.formDialog.onClose}
      />

      <DeleteUserDialog
        user={page.selected}
        isOpen={page.deleteDialog.isOpen}
        onOpenChange={page.deleteDialog.onOpenChange}
        onConfirm={page.confirmDelete}
        isPending={page.isDeleting}
      />
    </div>
  )
}
```

```tsx
// components/UsersTable.tsx: the four states (W13)
import { DataTable } from '@/app/components/UI/DataTable'
import { EmptyState } from '@/app/components/UI/EmptyState'
import { ErrorState } from '@/app/components/UI/ErrorState'
import { TablePagination } from '@/app/components/UI/TablePagination'
import { TableSkeleton } from '@/app/components/UI/TableSkeleton'
import { useT } from '@/app/i18n'
import { USER_COLUMNS } from '../data'
import type { User } from '../types'
import UserCell from './UserCell'

interface UsersTableProps {
  users: ReadonlyArray<User>
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  togglingId: string | null
  onEdit: (user: User) => void
  onDelete: (user: User) => void
  onToggleActive: (user: User, isActive: boolean) => void
}

export default function UsersTable({ users, page, totalPages, onPageChange, isLoading, isError, onRetry, ...cellProps }: UsersTableProps) {
  const t = useT()

  if (isLoading) return <TableSkeleton label={t('common.loading')} rows={10} />
  if (isError) return <ErrorState message={t('users.loadFailed')} onRetry={onRetry} />
  if (users.length === 0) return <EmptyState title={t('users.empty.title')} body={t('users.empty.body')} />

  return (
    <DataTable
      ariaLabel={t('users.table.label')}
      columns={USER_COLUMNS.map((column) => ({ ...column, label: t(column.labelKey) }))}
      items={users}
      renderCell={(user, columnKey) => <UserCell user={user} columnKey={columnKey} {...cellProps} />}
      footer={<TablePagination page={page} totalPages={totalPages} onPageChange={onPageChange} />}
    />
  )
}
```

```tsx
// components/UserCell.tsx
import { Button, Chip } from '@heroui/react'
import { ToggleSwitch } from '@/app/components/UI/ToggleSwitch'
import { useT } from '@/app/i18n'
import { PencilIcon } from '@/assets/svg/PencilIcon'
import { TrashIcon } from '@/assets/svg/TrashIcon'
import type { User, UserColumnKey } from '../types'

interface UserCellProps {
  user: User
  columnKey: UserColumnKey
  togglingId: string | null
  onEdit: (user: User) => void
  onDelete: (user: User) => void
  onToggleActive: (user: User, isActive: boolean) => void
}

export default function UserCell({ user, columnKey, togglingId, onEdit, onDelete, onToggleActive }: UserCellProps) {
  const t = useT()

  switch (columnKey) {
    case 'name':
      return <span className="text-sm font-medium text-fg">{user.name}</span>
    case 'email':
      return <span className="text-sm text-muted">{user.email}</span>
    case 'role':
      return <Chip variant="flat">{t(`users.roles.${user.role}`)}</Chip>
    case 'active':
      return (
        <ToggleSwitch
          label={t('users.actions.toggleActive', { name: user.name })}
          isSelected={user.isActive}
          isDisabled={togglingId === user.id}
          onChange={(isActive) => onToggleActive(user, isActive)}
        />
      )
    case 'actions':
      return (
        <div className="flex justify-end gap-1">
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('users.actions.edit', { name: user.name })} onPress={() => onEdit(user)}>
            <PencilIcon className="size-4" />
          </Button>
          <Button isIconOnly size="sm" variant="danger" aria-label={t('users.actions.delete', { name: user.name })} onPress={() => onDelete(user)}>
            <TrashIcon className="size-4" />
          </Button>
        </div>
      )
  }
}
```

```tsx
// components/UserForm.tsx: fields only; mobile-first grid (W9)
import { Controller, type Control } from 'react-hook-form'
import { FormField } from '@/app/components/UI/FormField'
import { SelectField } from '@/app/components/UI/SelectField'
import { useT } from '@/app/i18n'
import { ROLE_OPTIONS } from '../data'
import { USER_LIMITS, type UserFormValues } from '../schema'

export default function UserForm({ control, isEdit }: { control: Control<UserFormValues>; isEdit: boolean }) {
  const t = useT()

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <FormField
            label={t('users.form.name')}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            error={fieldState.error?.message}
            autoComplete="off"
            maxLength={USER_LIMITS.nameMax}
            isRequired
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <FormField
            label={t('users.form.email')}
            type="email"
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            error={fieldState.error?.message}
            autoComplete="off"
            maxLength={USER_LIMITS.emailMax}
            isDisabled={isEdit}
            isRequired
          />
        )}
      />
      {!isEdit && (
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <FormField
              label={t('users.form.password')}
              type="password"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              error={fieldState.error?.message}
              autoComplete="new-password"
              maxLength={USER_LIMITS.passwordMax}
              isRequired
            />
          )}
        />
      )}
      <Controller
        control={control}
        name="role"
        render={({ field, fieldState }) => (
          <SelectField
            label={t('users.form.role')}
            options={ROLE_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }))}
            selectedKey={field.value}
            onSelectionChange={field.onChange}
            error={fieldState.error?.message}
            isRequired
          />
        )}
      />
    </div>
  )
}
```

```tsx
// components/UserFormDialog.tsx: native <form noValidate> (W7), never HeroUI's <Form>
import { Button } from '@heroui/react'
import { AppModal } from '@/app/components/UI/AppModal'
import { useT } from '@/app/i18n'
import { useUserForm } from '../hooks/useUserForm'
import type { User } from '../types'
import UserForm from './UserForm'

interface UserFormDialogProps {
  user: User | null
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onDone: () => void
}

export default function UserFormDialog({ user, isOpen, onOpenChange, onDone }: UserFormDialogProps) {
  const t = useT()
  const { control, onSubmit, isEdit, isPending } = useUserForm({ user, onDone })

  return (
    <AppModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      isDismissable={!isPending}
      title={t(isEdit ? 'users.form.editTitle' : 'users.form.createTitle')}
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <UserForm control={control} isEdit={isEdit} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" isDisabled={isPending} onPress={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" isDisabled={isPending}>
            {isPending ? t('common.saving') : t(isEdit ? 'users.form.submitEdit' : 'users.form.submitCreate')}
          </Button>
        </div>
      </form>
    </AppModal>
  )
}
```

```tsx
// components/DeleteUserDialog.tsx: never window.confirm (W5)
import { ConfirmDialog } from '@/app/components/UI/ConfirmDialog'
import { useT } from '@/app/i18n'
import type { User } from '../types'

interface DeleteUserDialogProps {
  user: User | null
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onConfirm: () => void
  isPending: boolean
}

export default function DeleteUserDialog({ user, isOpen, onOpenChange, onConfirm, isPending }: DeleteUserDialogProps) {
  const t = useT()

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t('users.delete.title')}
      description={t('users.delete.description', { name: user?.name ?? '' })}
      confirmLabel={t('users.delete.confirm')}
      isPending={isPending}
      onConfirm={onConfirm}
    />
  )
}
```

## 8. Island root and page

```tsx
// Users.tsx
import { AuthGate } from '@/app/components/AuthGate'
import AppProviders, { type IslandProps } from '@/app/providers/AppProviders'
import UsersScreen from './components/UsersScreen'

export default function Users(props: IslandProps) {
  return (
    <AppProviders {...props}>
      <AuthGate requiredRole="admin">
        <UsersScreen />
      </AuthGate>
    </AppProviders>
  )
}
```

```astro
---
// src/pages/admin/users.astro
import TableSkeleton from '@/app/components/skeletons/TableSkeleton.astro'
import Users from '@/app/features/users/Users'
import { getT, resolveLocale } from '@/app/i18n'
import BaseLayout from '@/layouts/BaseLayout.astro'

const locale = resolveLocale(Astro.currentLocale)
const t = getT(locale)
---
<BaseLayout title={t('users.meta.title')} description={t('users.meta.description')} locale={locale} noindex>
  <main id="main" class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold text-fg">{t('users.title')}</h1>
      <p class="text-sm text-muted">{t('users.subtitle')}</p>
    </header>
    <!-- Private data in a static build: client-only island behind the session gate (WA2, WA11). -->
    <Users client:only="react" locale={locale} withToaster>
      <TableSkeleton slot="fallback" label={t('common.loading')} />
    </Users>
  </main>
</BaseLayout>
```

The heading is static HTML (WA1): it paints before any JS. The island is the page's Toaster host
because this page does not use `PublicLayout`.

## 9. i18n keys this feature adds (every locale, same change)

`users.meta.title`, `users.meta.description`, `users.title`, `users.subtitle`,
`users.table.label`, `users.columns.{name,email,role,active,actions}`,
`users.roles.{admin,member}`, `users.search.label`, `users.actions.{create,edit,delete,toggleActive}`,
`users.form.{createTitle,editTitle,name,email,password,role,submitCreate,submitEdit}`,
`users.delete.{title,description,confirm}`, `users.empty.{title,body}`, `users.loadFailed`,
`users.toast.{created,updated,deleted,statusChanged,createFailed,updateFailed,deleteFailed,statusFailed}`,
`errors.user.email-taken`. Shared ones (`common.*`, `validation.*`, `errors.unknown`) exist once.

## 10. Tests (W15)

| Spec | Proves |
|---|---|
| `usersService.test.ts` | DTO -> domain mapping (`createdAt` becomes a `Date`), params forwarded, endpoint used |
| `useUsersMutations.test.tsx` | each mutation invalidates `[USERS_KEY, ...]` by effect and toasts the translated success; errors show `t('errors.<code>')`, never the backend text (`data-layer.md` §9) |
| `useUserForm.test.tsx` | name required; email 254 chars passes and 255 fails (FT1); email lowercased; edit sends only `{ name, role }`; `user.email-taken` marks the email field |
| `UsersScreen.test.tsx` | skeleton while loading, error + retry, empty state, edit opens the dialog with the row's values, delete closes the dialog only on success |
