# HeroUI v3 in Astro islands

Enforces WA8 (and W7, W8 through the wrappers). Everything here was verified in production with
HeroUI v3; when a newer v3 release documents a part differently, follow the installed version's
docs and update the wrapper, never the features.

## 1. Install

Requirements: React 19 (18 works), Tailwind CSS v4.

```bash
npm i @heroui/react @heroui/styles framer-motion
```

- v3 uses `@heroui/styles`, not `@heroui/theme`. No `@plugin`, no `@source`, no `hero.ts`.
- No `HeroUIProvider`: components work without a provider.

## 2. CSS

In `src/styles/global.css`, Tailwind first, then HeroUI (order matters):

```css
@import "tailwindcss";
@import "@heroui/styles";
```

Selective import, when only some layers are wanted:

```css
@layer theme, base, components, utilities;

@import "tailwindcss";
@import "@heroui/styles/base" layer(base);
@import "@heroui/styles/themes/default" layer(theme);
@import "@heroui/styles/components" layer(components);
@import "@heroui/styles/utilities" layer(utilities);
```

## 3. Theme and tokens (W8)

- Light/dark is chosen by `data-theme="light|dark"` (plus the `dark` class) on `<html>`. The
  inline script in `BaseLayout.astro` sets both before the first paint. Without them HeroUI paints
  light-theme parts on a dark page (invisible labels, white popovers, unreadable chips).
- HeroUI reads its own CSS variables (`--accent`, `--accent-foreground`, `--background`,
  `--foreground`, `--surface`, `--field-background`, `--field-foreground`, `--field-placeholder`,
  `--muted`, `--success`, `--warning`, `--danger`). `templates/global.css` points them at the
  project's `--ui-*` tokens in both themes, so `<Button variant="primary">` paints with the
  project's accent instead of the library default.
- Components never override colors with hex or `var()`. If a part still ignores the theme, fix
  the bridge; as a last resort, override that part's `className` with a token class and the v4
  important suffix (`text-fg!`).

## 4. Components (dot notation)

### Button

```tsx
import { Button } from '@heroui/react'

<Button variant="primary" isDisabled={isPending} onPress={onSave}>
  {isPending ? t('common.saving') : t('common.save')}
</Button>
```

- `onPress`, never `onClick`; never a raw `<button>` in `.tsx`.
- `variant` (`primary`, `danger`, `ghost`), not `color`.
- No `isLoading`: `isDisabled` + a label or spinner.
- Icon-only: `isIconOnly` + `aria-label={t(...)}`; icons go in as children.

### Table

```tsx
import { Table } from '@heroui/react'

<Table>
  <Table.ScrollContainer>
    <Table.Content aria-label={t('users.table.label')}>
      <Table.Header>
        <Table.Column>{t('users.columns.name')}</Table.Column>
        <Table.Column>{t('users.columns.email')}</Table.Column>
      </Table.Header>
      <Table.Body>
        {users.map((user) => (
          <Table.Row key={user.id}>
            <Table.Cell>{user.name}</Table.Cell>
            <Table.Cell>{user.email}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Content>
  </Table.ScrollContainer>
</Table>
```

Features use the `DataTable` wrapper (components-ui.md §7).

### Pagination

```tsx
import { Pagination } from '@heroui/react'

<Pagination total={totalPages} page={page} onChange={setPage} />
```

Composable form, when the default layout does not fit:

```tsx
<Pagination page={page} onChange={setPage}>
  <Pagination.Content>
    <Pagination.Item><Pagination.Previous /></Pagination.Item>
    <Pagination.Item><Pagination.Link isActive>{page}</Pagination.Link></Pagination.Item>
    <Pagination.Item><Pagination.Next /></Pagination.Item>
  </Pagination.Content>
</Pagination>
```

### Modal with a trigger (uncontrolled)

```tsx
import { Button, Modal } from '@heroui/react'

<Modal>
  <Button>{t('users.actions.create')}</Button>
  <Modal.Backdrop>
    <Modal.Container>
      <Modal.Dialog>
        <Modal.Header>
          <Modal.Heading>{t('users.form.createTitle')}</Modal.Heading>
        </Modal.Header>
        <Modal.Body>{form}</Modal.Body>
        <Modal.Footer>
          <Button slot="close" variant="ghost">{t('common.cancel')}</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
</Modal>
```

Key props: `isDismissable` (backdrop click closes, default true), `placement`
(`center | top | bottom`), `size` (`xs | sm | md | lg | cover | full`).

### Modal controlled from state (the app's case)

The app opens dialogs from a hook (`isOpen`), with no trigger. `<Modal>` is a react-aria
`DialogTrigger`; controlled without a pressable child it logs
`A PressResponder was rendered without a pressable child`. Adding a hidden trigger with
`tabIndex={-1}` only trades it for `<Pressable> child must be focusable`.

```tsx
// Wrong: ModalRoot without a trigger
<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
  <Modal.Backdrop>...</Modal.Backdrop>
</Modal>

// Right: control the Backdrop (react-aria ModalOverlay) directly
<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
  <Modal.Container placement="center" size="md" scroll="inside">
    <Modal.Dialog>...</Modal.Dialog>
  </Modal.Container>
</Modal.Backdrop>
```

This lives in `AppModal`; features never assemble `Modal.*` themselves.

### Select

A `<Label>` placed next to (not inside) `<Select>` is not associated, and react-aria warns
`you must specify an aria-label or aria-labelledby`. Link them with `useId()` +
`aria-labelledby`, or pass `aria-label`. `SelectField` does it (components-ui.md §6).

### Switch

v3's `<Switch>` renders nothing visible without its parts:

```tsx
<Switch aria-label={label} isSelected={isSelected} onChange={onChange}>
  <Switch.Control>
    <Switch.Thumb />
  </Switch.Control>
</Switch>
```

Features use `ToggleSwitch`.

### Text fields

`Input` accepts no `label`. Compose `<TextField><Label /><Input /></TextField>`; `FormField` does
it and adds the error message and the in-dialog focus-ring classes.

## 5. `useDisclosure`

v3 does not export it. `templates/useDisclosure.ts` (`src/app/hooks/useDisclosure.ts`) is a
drop-in with the v2 API: `{ isOpen, onOpen, onClose, onOpenChange, onToggle }`.

## 6. v2 -> v3

| v2 | v3 |
|---|---|
| `@heroui/theme` + `@plugin` + `@source` | `@heroui/styles` via `@import` |
| `<HeroUIProvider>` | no provider |
| `TableHeader`, `TableColumn`... as separate imports | `Table.Header`, `Table.Column`... |
| `ModalContent`, `ModalHeader` | `Modal.Backdrop` > `Modal.Container` > `Modal.Dialog` > `Modal.Header` |
| `heroui()` plugin colors | CSS variables bridged to tokens |
| `useDisclosure` from `@heroui/react` | local hook |
| `Button color="primary"` | `Button variant="primary"` |
| `Button isLoading` | `isDisabled` + label |
| `Input label="..."` | `TextField` + `Label` + `Input` |
| `<Modal isOpen><ModalContent>` | `<Modal.Backdrop isOpen>` (controlled) |

## 7. In Astro

HeroUI components are React: they only run inside islands.

- Directive priority: `client:visible` > `client:idle` > `client:load` (WA2).
- Static build + `<ClientRouter />` + the QueryClient singleton: islands that render query data
  use `client:only="react"` with an `.astro` skeleton in `slot="fallback"`. The prerendered HTML
  of a data island is its loading state; on a later navigation the island hydrates against the
  cached data, the text differs, React reports `Hydration failed` and re-renders the whole tree
  (a slow, blank-feeling navigation).
- Dev server: list `@heroui/react` and the other island dependencies in
  `vite.optimizeDeps.include`, and disable the dev toolbar (WA10). Otherwise Vite re-optimizes
  mid-session, the open page requests stale hashes, the island never hydrates and the console
  shows `504 (Outdated Optimize Dep)`.
