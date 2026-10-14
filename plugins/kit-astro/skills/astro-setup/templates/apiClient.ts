import axios, { isAxiosError, type InternalAxiosRequestConfig } from 'axios'
import { API_ENDPOINTS } from '@/app/api/endpoints'
import { env } from '@/app/config/env'
import { useAuthStore, type AuthUser, type Session } from '@/app/store/auth/authStore'

/**
 * Where a lost session goes. With the sign-in dialog option, point it at a page that opens the
 * dialog (references/routing-and-auth.md). The sign-in flow only accepts a same-site returnTo.
 */
export const SIGN_IN_PATH = '/sign-in'

const baseConfig = {
  baseURL: env.apiUrl,
  // Sends the httpOnly refresh cookie. The API must answer CORS with this exact origin and
  // `Access-Control-Allow-Credentials: true`.
  withCredentials: true,
  headers: { Accept: 'application/json' },
}

/** The client every service uses. Nothing outside services/ calls it (W4). */
export const apiClient = axios.create(baseConfig)

/** Bare client for the refresh call: no interceptors, so a failing refresh can never loop. */
const sessionClient = axios.create(baseConfig)

apiClient.interceptors.request.use((request) => {
  // The access token lives in memory only (W14); it is never written to storage.
  const { accessToken } = useAuthStore.getState()
  if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`)
  return request
})

let refreshInFlight: Promise<string | null> | null = null

async function requestSession(): Promise<string | null> {
  try {
    const { data } = await sessionClient.post<Session>(API_ENDPOINTS.auth.refresh)
    useAuthStore.getState().setSession(data)
    return data.accessToken
  } catch (error) {
    // 401/403 is the API's answer "no valid refresh cookie": the visitor is anonymous.
    // Anything else (offline, 5xx) says nothing about the session, so the caller gets the error.
    const status = isAxiosError(error) ? error.response?.status : undefined
    if (status === 401 || status === 403) {
      useAuthStore.getState().clearSession()
      return null
    }
    throw error
  }
}

/**
 * Single flight: concurrent 401s and the session bootstrap share ONE refresh request.
 * Resolves with the new access token, or null when there is no session.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= requestSession().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

/**
 * Session bootstrap on app start. It is the queryFn of the session query
 * (src/app/tanstack-queries/sessionQuery.ts), so it runs once per page load, is shared by every
 * island through the QueryClient singleton, and never runs inside an effect (W3).
 * Resolves with the user, or null for an anonymous visitor.
 */
export async function bootstrapSession(): Promise<AuthUser | null> {
  const accessToken = await refreshSession()
  return accessToken ? useAuthStore.getState().user : null
}

/** Sign-in URL that brings the visitor back to the current page. Client only (event time). */
export function signInHref(): string {
  const returnTo = `${window.location.pathname}${window.location.search}`
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`
}

let isRedirecting = false

function redirectToSignIn(): void {
  if (isRedirecting || window.location.pathname === SIGN_IN_PATH) return
  isRedirecting = true
  window.location.assign(signInHref())
}

type RetriableRequest = InternalAxiosRequestConfig & { _retried?: boolean }

apiClient.interceptors.response.use(undefined, async (error: unknown) => {
  if (!isAxiosError(error) || error.response?.status !== 401 || !error.config) throw error

  const request: RetriableRequest = error.config
  // Only a request sent WITH a session can be repaired. An anonymous 401 (or one on the server,
  // where no token exists) goes back to the caller, whose onError shows the coded message.
  if (request._retried || !request.headers.has('Authorization')) throw error
  request._retried = true

  const accessToken = await refreshSession()
  if (!accessToken) {
    redirectToSignIn()
    throw error
  }
  // The request interceptor attaches the new token to the retry.
  return apiClient(request)
})
