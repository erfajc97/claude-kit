---
name: brand-reference
description: Create docs/brand.md for a project that has no brand yet (palette as light and dark tokens, typography, spacing and radius, motion, voice and tone, logo usage, do/don't), then point kit.json "brand" at it so builders and the UI auditor use it. Use for /kit-design:brand-reference, or when /kit:kickoff or /kit:adopt chose "create a brand reference".
argument-hint: "[product name]"
---

# /kit-design:brand-reference — a brand for a project that has none

You write ONE document, `docs/brand.md`, and set `brand` in `.claude/kit.json`. You never
write application code or theme files and never commit (G7): mirroring the tokens into the
theme is a builder task.

## Method skills (external, optional)

These third-party skills are not shipped with the kit; `/kit:kickoff` and `/kit:adopt` offer
to install them from the kit's `external-skills.json`. Use each one the session lists. When
one is missing, use the fallback and name it in the hand-over.

| Skill | Used in | Fallback when missing |
|---|---|---|
| `impeccable` | step 2 (its teach-mode questions), step 3 (font selection, anti-patterns) | the questions and rules written below |
| `design-taste-frontend` (taste-skill) | step 3 (anti-slop check of each direction) | the Don't list in step 3 |
| `design-tokens` | step 4 (token categories, dark mode that is not an inversion) | the token list in step 4 |
| `emil-design-eng` | step 4 (motion tokens) | the motion defaults in step 4 |

They give method only. The project's `CLAUDE.md` wins over them: tokens only (`W8`/`M9`),
Tailwind v4 CSS-first `@theme` with no `tailwind.config` (`WA9`), HeroUI v3 (`WA8`). Do not
let them write a design context into `CLAUDE.md` or pick another UI kit.

## 1. Preflight (read-only)

- Read `.claude/kit.json`: `locale.ui`, the scopes (kind `web` / `mobile`, stack), `brand`.
  Missing → say so, still write the doc, skip step 8 and suggest `/kit:adopt`.
- `brand` already points to an existing file → stop and offer to review or extend it.
- Glob what exists: `docs/brand*`, `.impeccable.md`, `**/design-tokens/**`, the global CSS
  (`@theme`, `:root` variables), theme modules (`theme.*`, `tokens.*`), logos and icons
  (`**/logo*.{svg,png}`, `public/favicon*`, the app icon in the Expo config). Existing values
  are inputs to keep or to question, never to replace silently.

## 2. Ask once

One message, each question with its default; accept "defaults".

1. Product and audience: what it does, who uses it, where (desk, phone on the move).
2. Personality: three words it IS (not "modern", "clean" or "elegant") and three it is NOT.
3. References and anti-references (sites or apps) and what exactly about each.
4. Themes: light, dark or both (default both). Colors that must stay (logo) or never appear.
5. Logo: path to the files, or "none yet".
6. Voice in `locale.ui`: formality, pronoun (`tú` / `usted` / `vos` / `you`), words to use
   and to avoid.
7. Accessibility target (default WCAG 2.2 AA) and reduced-motion needs.
8. Fonts: free and self-hosted only (default) or licensed families the project owns.

## 3. Choose a direction

Propose 2 or 3 directions that really differ (not one idea in three colors). For each: a
name, three words, five swatches, a type pairing and one signature detail. Pick fonts from
the brief, not from habit. Don't: reflex faces as the brand face (Inter, Roboto, Arial, Open
Sans, the system default), purple-to-blue gradients, neon on dark, gradient text, pure
`#000000` or `#ffffff`, glassmorphism everywhere, empty stat grids. The user picks one or
mixes them.

## 4. Derive the tokens

- **Color.** Semantic names, both themes designed (dark is not an inversion). At least:
  `brand-500`, `brand-600`, `on-brand`, `accent`, `surface`, `surface-raised`, `fg`, `muted`,
  `border`, `danger`, `success`, `warning`. Add a token only when it has a use. Values in
  `#rrggbb`, one format for the whole doc. Neutrals lean toward the brand hue; status colors
  mean status, never decoration.
- **Spacing and shape.** Web: Tailwind's default 4 px scale, no custom spacing tokens.
  Mobile: the same 4 px steps in the theme module. Radii: `card`, `control`, `full`.
  Shadows: none, or at most three named levels.
- **Typography.** Roles `display`, `body`, `mono` (or none): family, weights, a size scale
  of at most 6 steps with a ratio of 1.25 or more, line heights, mobile → desktop sizes.
  Body lines 65–75 characters. Fonts self-hosted (or preconnected) with `display=swap`; note
  each font's license.
- **Motion.** `duration-fast` ≈ 150 ms, `duration-normal` ≈ 250 ms (nothing over 400 ms in
  product UI), ease-out to enter, ease-in to leave; under `prefers-reduced-motion`, opacity
  only.

## 5. Check contrast

Pairs, in both themes: `fg` / `surface`, `muted` / `surface`, `on-brand` / `brand-500`,
`brand-500` / `surface` (links), each status color / `surface`. Text needs 4.5:1, large text
and UI parts 3:1. Measure each pair:

```bash
node -e "const L=h=>{const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const [a,b]=process.argv.slice(1).map(L).sort((x,y)=>y-x);console.log(((a+.05)/(b+.05)).toFixed(2))" '#1f2937' '#fafaf9'
```

Adjust the token, not the rule, until every pair passes. Record each ratio in the doc.

## 6. Voice, logo, do and don't

- **Voice:** formality, pronoun, three adjectives we sound and never sound, words to use and
  to avoid, and three sample strings in `locale.ui` (an error, an empty state, a button).
  Errors say what happened and what to do next; empty states teach the first action;
  buttons are verbs.
- **Logo:** with files → paths, minimum size, clear space, light and dark variants, never
  recolor or stretch. Without → write "none yet" and a wordmark rule (display family,
  weight, `fg` or `brand-500`). Never invent or generate a logo file.
- **Do / don't:** at least five rows specific to this brand, plus the step 3 Don'ts.

## 7. Write `docs/brand.md`

If the file exists, ask before changing it. Sections, in this order (the UI auditor reads
them):

1. `# Brand reference — <project>` and one line: values here are the source; the theme
   mirrors them one to one; change this file first, then the theme, in the same commit.
2. `## Design context`: audience, personality (is / is not), direction, 3–5 principles.
3. `## Tokens`: table `Token | Light | Dark | Use`; the contrast table with ratios; radii,
   spacing, shadows and motion.
4. `## Typography`: table `Role | Family | Weights | Size / line height (mobile → desktop)`,
   and how fonts load.
5. `## Voice and tone`, 6. `## Imagery and logo`, 7. `## Do / don't`.
8. `## Token mapping`: how code names each token. Web (Tailwind v4): `--color-brand-500` in
   the `@theme` of the global CSS → `bg-brand-500`, `--radius-card` → `rounded-card`,
   `--font-display` → `font-display`; HeroUI v3 variables (`--accent`, `--surface`,
   `--danger`, …) point to these tokens. Mobile: the key of each token in the theme module.

Values appear only in this doc and in the single theme definition. Never show a literal
value inside a component example: components use token names (`W8`, `M9`).

## 8. Point the kit at it

- Set `"brand": "docs/brand.md"` in `.claude/kit.json`, changing no other key, then
  validate: `node -e "JSON.parse(require('fs').readFileSync('.claude/kit.json','utf8')); console.log('kit.json ok')"`.
- `CLAUDE.md` was composed with the old value: tell the user to run `/kit:adopt --update`
  so the header and `W8` / `M9` name the brand file.
- If `impeccable` is installed and `.impeccable.md` does not exist, create it with only:
  `## Design Context` and the line "Source of truth: docs/brand.md (Design context, Tokens,
  Typography, Voice and tone). Read it before any design work."

## 9. Hand over

Report: the files written; the direction chosen and why; the contrast table; the method
skills used and the ones missing; open questions (logo, font licenses). Next step: a builder
task that mirrors the tokens into the theme (web: `@theme` in the global CSS plus the HeroUI
variable mapping; mobile: the theme module), committed together with `docs/brand.md`. From
then on `kit:auditor-ux` checks colors, typography and voice against the doc.
