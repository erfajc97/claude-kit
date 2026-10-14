import { defineMiddleware } from 'astro:middleware'

/**
 * Route prefixes that need a session. Same areas as PRIVATE_PREFIXES in astro.config.mjs,
 * minus the sign-in page, which is reachable without a session but not indexed.
 */
const PRIVATE_PREFIXES = ['/account', '/admin'] as const

/**
 * Cookie that tells this server a session MAY exist: the API's refresh cookie when the API
 * shares the site and scopes the cookie to the parent domain. Its presence proves nothing (the
 * API authorizes every request); it only avoids rendering a private page for a visitor who has
 * no session at all. When the browser never sends such a cookie here, keep private pages static
 * and client-gated instead (WA11).
 */
const SESSION_HINT_COOKIE = 'refresh_token'
const SIGN_IN_PATH = '/sign-in'

const isPrivatePath = (pathname: string): boolean =>
  PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

/**
 * Runs for on-demand pages (`export const prerender = false`). Prerendered pages execute it at
 * build time, where there is no visitor to check: their protection is the client-only gate.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered || !isPrivatePath(context.url.pathname)) return next()

  if (!context.cookies.has(SESSION_HINT_COOKIE)) {
    const returnTo = `${context.url.pathname}${context.url.search}`
    return context.redirect(`${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`)
  }

  const response = await next()
  // Private HTML: never indexed (WA6), never stored by shared caches (WA5).
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  response.headers.set('Cache-Control', 'private, no-store')
  return response
})
