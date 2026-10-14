import { useCallback, useState } from 'react'

/**
 * Open/close state for dialogs, drawers and menus. HeroUI v3 does not export useDisclosure, so
 * this is a drop-in replacement with the v2 API. The component that renders the trigger owns
 * the disclosure; ephemeral dialog state never goes to a Zustand store.
 */
export function useDisclosure(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen)
  const onOpen = useCallback(() => setIsOpen(true), [])
  const onClose = useCallback(() => setIsOpen(false), [])
  const onOpenChange = useCallback((open: boolean) => setIsOpen(open), [])
  const onToggle = useCallback(() => setIsOpen((open) => !open), [])
  return { isOpen, onOpen, onClose, onOpenChange, onToggle }
}
