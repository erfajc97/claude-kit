import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { DEFAULT_LOCALE, getT, LocaleContext, readStoredLocale, setEventLocale, type Locale } from '@/app/i18n'
import { queryClient } from '@/app/lib/queryClient'

/** Props every island root accepts and forwards to AppProviders. */
export interface IslandProps {
  /**
   * Locale the page was rendered in, when the URL decides it (Astro i18n routing).
   * Omit it when a stored preference decides: the providers then mount-gate it.
   */
  locale?: Locale
  /** Exactly one island per page hosts the Toaster (WA3). On public pages it is the header island. */
  withToaster?: boolean
}

interface AppProvidersProps extends IslandProps {
  children: ReactNode
}

const subscribeToNothing = () => () => {}
const onClient = () => true
const onServer = () => false

/**
 * Wraps every island root (WA3). Islands are separate React trees, so each one mounts the
 * providers; all of them share the module-level QueryClient. Zustand stores need no provider.
 */
export default function AppProviders({ children, locale, withToaster = false }: AppProvidersProps) {
  // Mount gate (W3, WA2): false on the server and during hydration, true afterwards.
  const isHydrated = useSyncExternalStore(subscribeToNothing, onClient, onServer)
  // The server rendered `locale` (or the default). A stored preference applies only after
  // hydration, so the first client render matches the HTML and React reports no mismatch.
  const activeLocale = locale ?? (isHydrated ? readStoredLocale() : DEFAULT_LOCALE)

  useEffect(() => {
    // Mutations and toast helpers translate outside React (`t` from @/app/i18n): keep them on
    // the locale this island renders. Syncing a module that lives outside React is an effect's job.
    setEventLocale(activeLocale)
  }, [activeLocale])

  return (
    <LocaleContext value={activeLocale}>
      <QueryClientProvider client={queryClient}>
        {children}
        {withToaster && (
          <Toaster
            position="bottom-right"
            containerAriaLabel={getT(activeLocale)('a11y.notifications')}
            toastOptions={{
              // Contained exception to "no var() in components" (W8): sonner paints toasts with
              // inline styles inside a portal, so it reads the theme tokens directly. Tokens only.
              style: {
                background: 'var(--ui-surface)',
                color: 'var(--ui-fg)',
                border: '1px solid var(--ui-border)',
              },
            }}
          />
        )}
      </QueryClientProvider>
    </LocaleContext>
  )
}
