# UI components: wrappers, states, accessibility

Enforces W7, W8, W9, W10, W13 and WA8, WA9. HeroUI v3 API details are in `heroui-v3.md`.

## 1. Rules

- **Wrappers only (W7).** Features never use raw `<button> <input> <select> <textarea> <table>`
  in `.tsx`, and never assemble HeroUI's `Modal`, `Table`, `Pagination`, `Switch` or `Select` by
  hand: they use the wrappers in `src/app/components/UI/` (or the project's UI package, if it has
  one). `Button` and `Chip` from `@heroui/react` are used directly. A HeroUI pattern used twice
  with the same configuration becomes a wrapper.
- **Native forms.** `<form noValidate onSubmit={...}>`; never HeroUI's `<Form>` (it leaks a live
  region banner next to the header when validation fires). Validation is zod + react-hook-form;
  messages render under each field.
- **Buttons**: `onPress`, never `onClick`. `variant="primary"` for the main action, `"danger"`
  for destructive ones, `"ghost"` for cancel and secondary actions. There is no `isLoading` in
  v3: use `isDisabled={isPending}` and swap the label (`t('common.saving')`).
- **Destructive confirmations** use `ConfirmDialog`; no `window.alert/confirm/prompt` (W5).
- **Inputs inside dialogs** carry `box-border w-full max-w-full focus:ring-inset`: the dialog
  clips overflow, so an outset focus ring gets cut. `FormField` already does it.
- **`autoComplete`**: `off` on admin text fields, `new-password` when creating a password,
  `current-password` / `email` on sign-in.
- `.astro` files have no HeroUI: native elements styled with tokens are correct there.

## 2. Inventory (`src/app/components/UI/`)

| Wrapper | Props (contract) | Notes |
|---|---|---|
| `AppModal` | `isOpen, onOpenChange, title, children, footer?, size?, placement?, isDismissable?` | controlled, no trigger (§3) |
| `ConfirmDialog` | `isOpen, onOpenChange, title, description, confirmLabel, isPending, onConfirm` | built on AppModal |
| `DataTable` | `ariaLabel, columns, items, renderCell, footer?` | HeroUI Table, dot notation |
| `TablePagination` | `page, totalPages, onPageChange` | renders nothing for one page |
| `ToggleSwitch` | `label, isSelected, onChange, isDisabled?` | Switch.Control + Switch.Thumb inside |
| `FormField` | `label, value, onChange, onBlur?, name?, error?, type?, inputMode?, autoComplete?, maxLength?, isRequired?, isDisabled?, ref?` | TextField + Label + Input |
| `TextAreaField` | same as FormField, plus `rows?` | same composition with HeroUI's text area |
| `SelectField` | `label, options, selectedKey, onSelectionChange, error?, isRequired?, isDisabled?` | accessible name wired by id (§6) |
| `CheckboxField` | `label, isSelected, onChange, error?, isDisabled?` | |
| `SearchField` | `label, value, onChange` | FormField with `type="search"` |
| `EmptyState` / `ErrorState` | `title, body, action?` / `message, onRetry` | W13 |
| `TableSkeleton` | `label, rows?` | React twin of `skeletons/TableSkeleton.astro` |

Wrappers take translated strings as props and use `useT()` only for their own generic copy
(`common.cancel`, `common.retry`). They hold no business logic and are extended through props.

## 3. `AppModal`: controlled, without a trigger

```tsx
import type { ReactNode } from 'react'
import { Modal } from '@heroui/react'

interface AppModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'cover' | 'full'
  placement?: 'center' | 'top' | 'bottom'
  isDismissable?: boolean
}

/**
 * The app opens dialogs from state, not from a trigger. The Backdrop (react-aria ModalOverlay)
 * takes isOpen/onOpenChange directly; wrapping it in <Modal> (a DialogTrigger) without a pressable
 * child logs "A PressResponder was rendered without a pressable child".
 */
export function AppModal({
  isOpen,
  onOpenChange,
  title,
  children,
  footer,
  size = 'md',
  placement = 'center',
  isDismissable = true,
}: AppModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={isDismissable}>
      <Modal.Container placement={placement} size={size} scroll="inside">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          {footer && <Modal.Footer>{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
```

A dialog with a form puts the `<form>` and its action buttons inside the body, so Enter submits
and the submit button needs no `form` attribute.

## 4. `ConfirmDialog`

```tsx
import type { ReactNode } from 'react'
import { Button } from '@heroui/react'
import { useT } from '@/app/i18n'
import { AppModal } from './AppModal'

interface ConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  isPending: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ isOpen, onOpenChange, title, description, confirmLabel, isPending, onConfirm }: ConfirmDialogProps) {
  const t = useT()
  return (
    <AppModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      isDismissable={!isPending}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" isDisabled={isPending} onPress={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" isDisabled={isPending} onPress={onConfirm}>
            {isPending ? t('common.working') : confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted">{description}</p>
    </AppModal>
  )
}
```

The caller closes it in the mutation's per-call `onSuccess`; the toast lives in the mutation.

## 5. `ToggleSwitch` and `FormField`

```tsx
import { Switch } from '@heroui/react'

interface ToggleSwitchProps {
  /** Accessible name: a switch in a table cell has no visible label. */
  label: string
  isSelected: boolean
  onChange: (isSelected: boolean) => void
  isDisabled?: boolean
}

/** HeroUI v3's Switch renders empty without its Control and Thumb parts. */
export function ToggleSwitch({ label, isSelected, onChange, isDisabled }: ToggleSwitchProps) {
  return (
    <Switch aria-label={label} isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch>
  )
}
```

```tsx
import { useId, type Ref } from 'react'
import { Input, Label, TextField } from '@heroui/react'
import { isMessageKey, useT } from '@/app/i18n'

interface FormFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  name?: string
  /** An i18n key, as produced by the zod schema or by form.setError. */
  error?: string
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'search'
  inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel' | 'url' | 'search'
  autoComplete?: string
  maxLength?: number
  isRequired?: boolean
  isDisabled?: boolean
  ref?: Ref<HTMLInputElement>
}

/** v3's Input takes no `label`: the wrapper composes TextField + Label + Input. */
export function FormField({ label, error, ref, ...fieldProps }: FormFieldProps) {
  const t = useT()
  const errorId = useId()
  return (
    <TextField
      {...fieldProps}
      isInvalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
      className="flex w-full min-w-0 flex-col gap-1"
    >
      <Label className="text-sm font-medium text-fg">{label}</Label>
      <Input ref={ref} className="box-border w-full max-w-full focus:ring-inset" />
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {t(isMessageKey(error) ? error : 'validation.invalid')}
        </p>
      )}
    </TextField>
  )
}
```

Number-like values (prices, quantities, codes) use `type="text"` with `inputMode="decimal"` or
`"numeric"`; never `type="number"` (W11): it accepts `e`, drops trailing zeros, changes on scroll,
and turns an empty field into `0` in naive parsers.

## 6. `SelectField`: accessible name

react-aria warns `you must specify an aria-label or aria-labelledby` when the `<Label>` is a
SIBLING of `<Select>` (it is only associated automatically as a child). The wrapper links them by
id, which also works for a visually hidden (`sr-only`) label:

```tsx
// Inside SelectField: the label and the select share one generated id.
const labelId = useId()
const labelProps = { id: labelId }                  // spread on <Label>
const selectProps = { 'aria-labelledby': labelId }  // spread on <Select>
```

The rest of `SelectField` composes the Select parts (trigger showing the current value, popover
with the list box) exactly as the installed HeroUI v3 documentation shows, maps `selectedKey` /
`onSelectionChange` to the props contract of §2, and renders the error under the control like
`FormField`.

The same rule applies to every react-aria control without a visible associated label
(`ComboBox`, icon-only `Button`): `aria-labelledby` to a label id, or `aria-label={t(...)}`.

## 7. `DataTable` and `TablePagination`

```tsx
import type { ReactNode } from 'react'
import { Table } from '@heroui/react'

export interface DataTableColumn<TKey extends string = string> {
  key: TKey
  label: string
  align?: 'start' | 'center' | 'end'
}

interface DataTableProps<TItem extends { id: string }, TKey extends string> {
  ariaLabel: string
  columns: ReadonlyArray<DataTableColumn<TKey>>
  items: ReadonlyArray<TItem>
  renderCell: (item: TItem, columnKey: TKey) => ReactNode
  footer?: ReactNode
}

const ALIGN_CLASS = { start: 'text-start', center: 'text-center', end: 'text-end' } as const

export function DataTable<TItem extends { id: string }, TKey extends string>({
  ariaLabel,
  columns,
  items,
  renderCell,
  footer,
}: DataTableProps<TItem, TKey>) {
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={ariaLabel}>
            <Table.Header>
              {columns.map((column) => (
                <Table.Column key={column.key} className={ALIGN_CLASS[column.align ?? 'start']}>
                  {column.label}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row key={item.id}>
                  {columns.map((column) => (
                    <Table.Cell key={column.key} className={ALIGN_CLASS[column.align ?? 'start']}>
                      {renderCell(item, column.key)}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {footer}
    </div>
  )
}
```

```tsx
import { Pagination } from '@heroui/react'

interface TablePaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function TablePagination({ page, totalPages, onPageChange }: TablePaginationProps) {
  if (totalPages <= 1) return null
  return (
    <div className="flex justify-center">
      <Pagination total={totalPages} page={page} onChange={onPageChange} />
    </div>
  )
}
```

Columns live in the feature's `data.ts` with label KEYS; the table component translates them.
The cell switch is a dumb component (`UserCell`), not JSX returned from a hook.

## 8. States (W13)

Every data view renders loading, error with retry, empty, and data:

```tsx
import { Button } from '@heroui/react'
import { useT } from '@/app/i18n'

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT()
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-6 text-center">
      <p className="text-sm text-fg">{message}</p>
      <Button variant="ghost" onPress={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
```

```tsx
export function TableSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="h-12 rounded-field bg-surface-raised motion-safe:animate-pulse" />
      ))}
    </div>
  )
}
```

```astro
---
// src/app/components/skeletons/TableSkeleton.astro: fallback of client:only islands (WA2)
interface Props {
  label: string
  rows?: number
}
const { label, rows = 8 } = Astro.props
---
<div role="status" class="flex flex-col gap-2">
  <span class="sr-only">{label}</span>
  <div aria-hidden="true" class="h-11 w-full max-w-sm rounded-field bg-surface-raised motion-safe:animate-pulse"></div>
  {Array.from({ length: rows }, () => (
    <div aria-hidden="true" class="h-12 rounded-field bg-surface-raised motion-safe:animate-pulse"></div>
  ))}
</div>
```

`EmptyState` follows the same shape: a title, one sentence, and the next action when there is one.
A `FormSkeleton.astro` (title + a few field bars) covers form pages.

## 9. Mobile first (W9) and accessibility (W10)

- Unprefixed utilities target the smallest screen; `sm:` / `md:` add columns. Paired fields
  stack on phones: `grid gap-4 sm:grid-cols-2`. Action rows: `flex flex-col-reverse gap-2 sm:flex-row`.
- Touch targets are at least 44 px (`size-11`, `min-h-11`). Check every screen at 360 px wide.
- Navigation collapses to a drawer or menu below `md`; the desktop list uses `hidden md:flex`.
- Tables scroll horizontally inside `Table.ScrollContainer`; never let the page scroll sideways.
- Every control has an accessible name; icon-only buttons get `aria-label={t(...)}`; decorative
  icons are `aria-hidden`.
- Focus is always visible (the global `:focus-visible` outline uses the focus token).
- Animations respect `prefers-reduced-motion` (`motion-safe:` / `motion-reduce:`).
- Text contrast: body text 4.5:1, large text and UI parts 3:1, in BOTH themes.

## 10. Styling: tokens and Tailwind v4 (W8, WA9)

- Only token classes: `bg-canvas`, `bg-surface`, `bg-surface-raised`, `text-fg`, `text-muted`,
  `border-border`, `bg-accent text-on-accent`, `bg-brand-500`, `text-success`, `text-warning`,
  `text-danger`, `rounded-field`, `rounded-card`. No hex, `oklch()`, `var(--...)`, arbitrary color
  values (`bg-[#...]`) or palette classes (`text-white`, `bg-gray-100`) in `.tsx` / `.astro`.
  The single contained exception is the Toaster style in `AppProviders` (tokens via `var()`).
- Tailwind v4 canonical classes (v3 habit -> v4 class with the same look):

| v3 habit | v4 canonical |
|---|---|
| `shadow-sm` / `shadow` | `shadow-xs` / `shadow-sm` (the scale shifted one step) |
| `rounded-sm` / `rounded` | `rounded-xs` / `rounded-sm` |
| `blur-sm` / `blur` | `blur-xs` / `blur-sm` |
| `outline-none` | `outline-hidden` (keeps an outline in forced-colors mode) |
| `ring` (3px) | `ring-3` (bare `ring` is 1px in v4) |
| `bg-gradient-to-r` | `bg-linear-to-r` |
| `flex-shrink-0`, `flex-grow` | `shrink-0`, `grow` |
| `bg-opacity-50` | `bg-fg/50` (opacity modifier) |
| `overflow-ellipsis` | `text-ellipsis` |
| `h-4 w-4` | `size-4` |
| `!text-fg` | `text-fg!` (important is a suffix) |

- When a HeroUI part ignores the theme, fix the variable bridge in `global.css` first; only then
  override that part's `className` with an important suffix.
- After changing a shared wrapper, sweep the hand-built copies too: Grep `<Modal`, `<Select`,
  `<Switch` and `<Table` across `src/app/features` and fix every match, not only the wrapper.
