/**
 * Every API path in one place. Services import from here and nothing else builds URLs.
 * Paths are relative to the axios baseURL (env.apiUrl). Dynamic segments are encoded.
 * One block per resource; add resources as the API grows.
 */
const segment = (value: string): string => encodeURIComponent(value)

export const API_ENDPOINTS = {
  auth: {
    signIn: '/auth/sign-in',
    signUp: '/auth/sign-up',
    signOut: '/auth/sign-out',
    /** Reads the httpOnly refresh cookie, returns `{ accessToken, user }`. */
    refresh: '/auth/refresh',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    verifyEmail: '/auth/verify-email',
  },
  users: {
    list: '/users',
    /** Admin list: every row regardless of status, stable `createdAt asc` order. */
    adminList: '/users/admin',
    detail: (id: string) => `/users/${segment(id)}`,
    status: (id: string) => `/users/${segment(id)}/status`,
  },
} as const
