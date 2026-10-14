# Icons, images and static assets

Supports W2, W10, W13 and WA1.

## 1. Icons: one file, one component

- Every SVG icon is a React component in `src/assets/svg/<Name>Icon.tsx`, one per file. Never
  paste `<svg>` markup into feature components, and never group several icons in one file.
- Icons used only in `.astro` can also be rendered there: a React component without a `client:*`
  directive renders to static HTML and ships no JS. Pass `className`, not `class`.
- A general-purpose icon library (for example `lucide-react`) is fine for generic glyphs; the
  project's own marks (logo, product symbols) live in `src/assets/svg/`.

```tsx
// src/assets/svg/PlusIcon.tsx
import type { SVGProps } from 'react'

export function PlusIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
```

- Color comes from `currentColor`, so the parent's token class (`text-muted`, `text-on-accent`)
  colors the icon. Fixed fills are only for multi-color brand marks.
- Size comes from the caller (`className="size-4"`).
- Decorative by default (`aria-hidden`). When an icon carries meaning on its own, the control
  that contains it gets `aria-label={t(...)}`; the icon stays hidden.

## 2. Images

- Content images are imported and rendered with `astro:assets` (`<Image>` / `<Picture>`): sized,
  converted to modern formats, lazy by default. Remote images need `width` and `height` (or
  `inferSize`) and their host in `image.domains` / `image.remotePatterns`.
- `public/` holds files served as-is under a stable URL: `favicon.svg`, `og-default.png`
  (1200x630), videos referenced by path.
- Every meaningful image has a translated `alt`; decorative images use `alt=""`.
- The LCP image is eager with `fetchpriority="high"`; the rest stay lazy.

## 3. Resilient images in islands (W13)

Images from the API can 404. An island never shows a broken-image icon: it swaps to a token-
colored placeholder.

```tsx
// src/app/components/UI/SafeImage.tsx
import { useState } from 'react'

interface SafeImageProps {
  src: string | null
  alt: string
  className?: string
}

export function SafeImage({ src, alt, className }: SafeImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || failedSrc === src) {
    return <div role="img" aria-label={alt} className={`bg-surface-raised ${className ?? ''}`} />
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={className} onError={() => setFailedSrc(src)} />
}
```

Storing the failed `src` (instead of a boolean) resets the fallback by derivation when the
source changes, with no effect (W3).
