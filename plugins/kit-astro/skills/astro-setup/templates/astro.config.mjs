// @ts-check
import { fileURLToPath } from 'node:url'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, envField } from 'astro/config'

/** Path prefixes that are never indexed nor listed in the sitemap (WA6, WA11). */
const PRIVATE_PREFIXES = ['/account', '/admin', '/sign-in']

export default defineConfig({
  // Absolute origin for canonical, Open Graph, JSON-LD and sitemap URLs (WA6).
  site: '{{site_url}}',

  // Static by default. A page opts into on-demand rendering with
  // `export const prerender = false`, which needs an adapter (`npx astro add <adapter>`).
  output: 'static',

  integrations: [
    react(),
    sitemap({
      filter: (page) => !PRIVATE_PREFIXES.some((prefix) => new URL(page).pathname.startsWith(prefix)),
    }),
  ],

  // Locale in the URL: `/` for the default locale, `/es/...` for the others.
  // Keep the list identical to LOCALES in src/app/i18n. Delete the block on single-locale sites.
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },

  // WA5: prefetch on hover; opt a link out with data-astro-prefetch="false".
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },

  // WA10: the toolbar's lazily optimized deps cause "504 Outdated Optimize Dep" while editing islands.
  devToolbar: { enabled: false },

  // WA7: typed environment. `context: 'client'` values are public by definition and end up in
  // the bundle; secrets are declared with `context: 'server', access: 'secret'` and read only
  // from server code (`astro:env/server`).
  env: {
    schema: {
      PUBLIC_API_URL: envField.string({ context: 'client', access: 'public' }),
    },
    validateSecrets: true,
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // ESM config file: there is no __dirname.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // WA10: list every heavy dependency an island imports, so Vite optimizes them at startup
    // instead of discovering them mid-session and invalidating the hashes the open page uses.
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@heroui/react',
        '@tanstack/react-query',
        'axios',
        'sonner',
        'zustand',
        'react-hook-form',
        '@hookform/resolvers/zod',
        'zod',
      ],
    },
  },
})
