# Public pages: landing, content, catalog

The public zone (home, content pages, listings, detail pages) is where Astro-first (WA1) and
SEO-first (WA6) pay off: static HTML, zero JS by default, islands only where a visitor interacts.

## 1. Principles

- **Pages and sections are `.astro`.** Hero, feature grids, testimonials, pricing tables, FAQs,
  footers: static components fed by props. The source of truth for a page is its `.astro` file
  in `src/pages/`, not a React "page component".
- **Copy comes from the i18n layer** in the frontmatter (`getT(locale)`), including titles,
  descriptions, `alt` texts and button labels. Static lists live in the feature's `data.ts` with
  i18n KEYS (`titleKey`), translated where they are rendered.
- **Interactive pieces are their own features** with a single island root each (W1): a
  newsletter form (`features/newsletter/Newsletter.tsx`), a contact form, a product configurator,
  a carousel. Below the fold they hydrate with `client:visible`.
- **One `<h1>` per page**, headings in order, landmarks (`header`, `main`, `footer`, `nav`).
- **Tokens only** (W8). A section that needs its own background gets a token in `global.css`
  (`--ui-section-alt` per theme, exposed as `--color-section-alt` -> `bg-section-alt`).

## 2. Folder

```text
src/app/features/landing/
├── components/
│   ├── layout/        # SiteHeader.astro, SiteFooter.astro, MobileNav.astro
│   └── sections/      # Hero.astro, FeatureGrid.astro, Faq.astro, SectionHeader.astro
├── data.ts            # nav items, feature cards, FAQ entries (keys + hrefs + image imports)
└── types.ts
```

The landing feature has no React root when nothing in it is interactive; that is the goal, not
an exception. Detail-page blocks of another domain (product, article) live in that domain's
feature (`features/product/components/ProductGallery.astro`).

## 3. A page

```astro
---
// src/pages/index.astro
import FeatureGrid from '@/app/features/landing/components/sections/FeatureGrid.astro'
import Hero from '@/app/features/landing/components/sections/Hero.astro'
import { FEATURE_CARDS } from '@/app/features/landing/data'
import Newsletter from '@/app/features/newsletter/Newsletter'
import { getT, resolveLocale } from '@/app/i18n'
import PublicLayout from '@/layouts/PublicLayout.astro'

const locale = resolveLocale(Astro.currentLocale)
const t = getT(locale)
const siteUrl = Astro.site ?? Astro.url

const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: t('site.name'),
  url: siteUrl.href,
  logo: new URL('/logo.png', siteUrl).href,
}
---
<PublicLayout
  title={t('home.meta.title')}
  description={t('home.meta.description')}
  locale={locale}
  alternates={[{ locale: 'en', path: '/' }, { locale: 'es', path: '/es/' }]}
  jsonLd={organization}
>
  <Hero
    title={t('home.hero.title')}
    subtitle={t('home.hero.subtitle')}
    imageAlt={t('home.hero.imageAlt')}
    ctaLabel={t('home.hero.cta')}
    ctaHref="/catalog"
  />
  <FeatureGrid
    title={t('home.features.title')}
    items={FEATURE_CARDS.map((card) => ({ ...card, title: t(card.titleKey), body: t(card.bodyKey) }))}
  />
  <Newsletter client:visible locale={locale} />
</PublicLayout>
```

```astro
---
// src/app/features/landing/components/sections/Hero.astro
import { Image } from 'astro:assets'
import heroImage from '@/assets/images/hero.jpg'

interface Props {
  title: string
  subtitle: string
  imageAlt: string
  ctaLabel: string
  ctaHref: string
}
const { title, subtitle, imageAlt, ctaLabel, ctaHref } = Astro.props
---
<section class="relative isolate overflow-hidden">
  <Image
    src={heroImage}
    alt={imageAlt}
    widths={[640, 1024, 1600]}
    sizes="100vw"
    loading="eager"
    fetchpriority="high"
    class="absolute inset-0 -z-10 size-full object-cover"
  />
  <div class="absolute inset-0 -z-10 bg-canvas/70" aria-hidden="true"></div>
  <div class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-20 sm:py-28">
    <h1 class="max-w-2xl text-4xl font-semibold text-balance text-fg sm:text-5xl">{title}</h1>
    <p class="max-w-xl text-lg text-muted">{subtitle}</p>
    <a href={ctaHref} class="inline-flex min-h-11 w-fit items-center rounded-field bg-accent px-6 font-medium text-on-accent">
      {ctaLabel}
    </a>
  </div>
</section>
```

The hero image is the LCP element: `loading="eager"` + `fetchpriority="high"`; every other image
stays lazy (the `<Image>` default) and has intrinsic dimensions, so nothing shifts.

## 4. SEO checklist (WA6)

| Item | How |
|---|---|
| Title | translated, at most 60 characters (`BaseLayout` warns in dev) |
| Description | translated, 100 to 155 characters |
| Canonical | absolute, from `site` + path (`BaseLayout`) |
| Open Graph / Twitter | title, description, absolute 1200x630 image (`ogImage`), `og:type` per page |
| Structured data | JSON-LD per page type: `Organization` (home), `BreadcrumbList`, `Product`, `Article`, `FAQPage` |
| Headings | exactly one `h1`; no skipped levels |
| Sitemap | `@astrojs/sitemap`, private prefixes filtered out (`astro.config.mjs`) |
| robots.txt | endpoint pointing at the sitemap |
| Private pages | `noindex` on the page (static) and `X-Robots-Tag` (on demand); not in the sitemap |
| Locales | `alternates` -> reciprocal `hreflang` + `x-default`; no automatic redirects |
| Links | descriptive text (never "click here"); `<a>` for navigation, buttons for actions |
| Images | translated `alt` (empty `alt=""` only for decoration), dimensions, lazy below the fold |
| Fonts | self-hosted `@font-face` with `font-display: swap`, preload only the main weight |

```ts
// src/pages/robots.txt.ts
import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap-index.xml', site).href
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
```

Private areas are kept out with `noindex`, not with `Disallow`: a crawler that may not fetch a
page never sees its `noindex` and can still index the bare URL from links.

```ts
// Product detail JSON-LD: the price stays the API's decimal string
const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  description: product.summary,
  image: product.images.map((image) => new URL(image.src, siteUrl).href),
  offers: {
    '@type': 'Offer',
    price: product.price,
    priceCurrency: product.currency,
    availability: 'https://schema.org/InStock',
    url: new URL(Astro.url.pathname, siteUrl).href,
  },
}
```

## 5. Persistent media across navigations (WA4)

A hero video that must keep playing while the visitor navigates is persisted, not re-mounted:

```astro
---
import { Image } from 'astro:assets'
import poster from '@/assets/images/hero-poster.jpg'
---
<video
  transition:persist="hero-video"
  autoplay
  muted
  loop
  playsinline
  poster={poster.src}
  class="size-full object-cover motion-reduce:hidden"
>
  <source src="/media/hero.webm" type="video/webm" />
</video>
<Image src={poster} alt="" class="hidden size-full object-cover motion-reduce:block" />
```

Visitors who prefer reduced motion get the poster instead of the loop.

## 6. Mobile navigation (W9)

- The desktop nav is a plain list with `hidden md:flex`.
- Below `md`: either a small island (`client:idle`) using `useDisclosure` + a HeroUI drawer or
  menu, or an `.astro` disclosure (`<button aria-expanded aria-controls>`) whose bundled script
  binds on `astro:page-load`. Either way: focus moves into the menu, Escape closes it, targets
  are at least 44 px.
- The header island (auth area) collapses its labels to icons on small screens; icon-only
  controls keep an `aria-label`.
