import { isAxiosError } from 'axios'
import { isMessageKey, type MessageKey } from '@/app/i18n'

/**
 * Reads the error code from the API's error envelope `{ code, message? }` (W6).
 * The backend `message` is never read here: it is neither shown nor compared.
 * Returns null for network errors, timeouts and bodies without a code.
 */
export function getApiErrorCode(error: unknown): string | null {
  if (!isAxiosError(error)) return null
  const body: unknown = error.response?.data
  if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string') {
    return body.code
  }
  return null
}

/**
 * Maps an API error code to its i18n key: `user.email-taken` -> `errors.user.email-taken`.
 * A code without a translation maps to `errors.unknown`; add the key to every locale file
 * in the same change that adds the code to the API's error catalog.
 */
export function translateError(code: string): MessageKey {
  const key = `errors.${code}`
  return isMessageKey(key) ? key : 'errors.unknown'
}
