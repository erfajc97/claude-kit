# Brand reference — {{project}}

The UI auditor (`auditor-ux`) checks colors, typography and voice against this file
(`kit.json` → `brand`). Values here are the source; the theme tokens in code mirror them
one to one. Change the brand here first, then the tokens, in the same commit.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `brand-500` | `#______` | `#______` | primary actions, links |
| `brand-600` | `#______` | `#______` | primary hover / pressed |
| `accent` | `#______` | `#______` | highlights, AI-proposed content |
| `surface` | `#______` | `#______` | page and card backgrounds |
| `fg` | `#______` | `#______` | body text |
| `muted` | `#______` | `#______` | secondary text |
| `danger` / `success` / `warning` | `#______` | `#______` | status only, never decoration |

**Contrast pairs that must pass WCAG AA** (4.5:1 text, 3:1 large text and UI parts):
`fg` on `surface`, white on `brand-500`, `muted` on `surface`, in both themes.

Radii: `rounded-card` = __ px, `rounded-control` = __ px. Spacing: the default 4 px scale.
Shadows: <none | the named ones>.

## Typography

| Role | Family | Weights | Size / line height (mobile → desktop) |
|---|---|---|---|
| Display | <family> | <600, 700> | <28/34 → 40/48> |
| Body | <family> | <400, 500> | <16/24> |
| Mono | <family or none> | | |

Fonts are self-hosted (or preconnected) with `display=swap`. No other families.

## Voice and tone

- **Language and locale:** {{locale.ui}}; formality: <formal | neutral | casual>;
  pronoun: <tú | usted | vos | you>.
- **We sound:** <three adjectives>. **We never sound:** <three adjectives>.
- **Words we use / avoid:** <use> · <avoid>.
- **Errors** say what happened and what to do next, without blame. **Empty states** teach
  the first action. **Buttons** are verbs.

## Imagery and logo

- Logo files: <paths>. Minimum size: <px>. Clear space: <rule>. Never recolor or stretch.
- Imagery: <style: photography / illustration / none>, <what to avoid>.

## Do / don't

| Do | Don't |
|---|---|
| <…> | <generic AI aesthetics: purple gradients, glassmorphism, empty stat grids> |
