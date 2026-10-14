import { t, type MessageKey } from '@/app/i18n'
import { sonnerResponse } from './sonnerResponse'
import { getApiErrorCode, translateError } from './translateError'

/**
 * Error toast for every mutation's onError (W5, W6):
 *   onError: (error) => toastApiError(error, 'users.toast.createFailed')
 * With an API code it shows t(translateError(code)); without one (offline, timeout, a body
 * without code) it shows t(fallbackKey). The backend `message` is never printed.
 */
export function toastApiError(error: unknown, fallbackKey: MessageKey): void {
  const code = getApiErrorCode(error)
  sonnerResponse(t(code ? translateError(code) : fallbackKey), 'error')
}
