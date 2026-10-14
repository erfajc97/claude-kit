import { toast } from 'sonner'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

/** Errors stay longer: the reader needs time to understand what failed. */
const DURATION_MS: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 6000,
}

/**
 * The only door to the toaster (W5). Mutations call it with an already translated message:
 * `sonnerResponse(t('users.toast.created'), 'success')`. Errors go through toastApiError.
 * Position and styling come from the page's single <Toaster> (bottom-right by default).
 */
export function sonnerResponse(message: string, kind: ToastKind): void {
  toast[kind](message, { duration: DURATION_MS[kind] })
}
