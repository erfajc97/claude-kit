import { PUBLIC_API_URL } from 'astro:env/client'

/**
 * Typed public configuration for client code (WA7). Everything here ends up in the bundle, so
 * it only ever re-exports `astro:env/client` values; secrets stay in `astro:env/server`.
 *
 * Why a module beside astro:env: it is the single seam tests mock (`vi.mock('@/app/config/env')`)
 * without resolving Astro's virtual modules, and the place for derived values.
 */
export const env = {
  /** API origin + base path, without a trailing slash: endpoints start with "/". */
  apiUrl: PUBLIC_API_URL.replace(/\/+$/, ''),
} as const
