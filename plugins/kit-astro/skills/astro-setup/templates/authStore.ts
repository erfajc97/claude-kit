import { create } from 'zustand'

/** The project's roles, mirroring the API's role enum. Schemas and options derive from this list. */
export const USER_ROLES = ['admin', 'member'] as const
export type UserRole = (typeof USER_ROLES)[number]

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

export interface Session {
  accessToken: string
  user: AuthUser
}

/** `unknown` until the session bootstrap answers: gated islands show their skeleton meanwhile. */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

interface AuthState {
  accessToken: string | null
  user: AuthUser | null
  status: SessionStatus
  setSession: (session: Session) => void
  clearSession: () => void
}

/**
 * Session state shared by every island (WA3).
 * In memory only (W14): no `persist` middleware, nothing in localStorage or sessionStorage.
 * The refresh token is an httpOnly cookie set by the API; after a reload the session comes back
 * through the bootstrap in apiClient.ts. The initial state is identical on server and client,
 * so reading it during the first render never causes a hydration mismatch (WA2).
 */
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  status: 'unknown',
  setSession: ({ accessToken, user }) => set({ accessToken, user, status: 'authenticated' }),
  clearSession: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}))
