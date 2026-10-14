import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

const MAX_QUERY_RETRIES = 1

/** A 4xx fails the same way again; only network errors and 5xx deserve a retry. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined
  if (status !== undefined && status < 500) return false
  return failureCount < MAX_QUERY_RETRIES
}

/**
 * The one QueryClient of the page (W4, WA3). Islands are separate React trees but import this
 * same module, so they share one cache; with ClientRouter the cache also survives navigations.
 * Never prefetch into it on the server: during SSR this module is shared by every request.
 * Mutations and hooks reach it through useQueryClient(), so tests can provide their own client.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})
