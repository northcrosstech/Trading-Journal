/** Helpers for the app-wide keyboard shortcuts (Search, Log). Browser autofill can fire key
 * events with no key at all, hence the optional chaining on e.key. */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/** How the Search shortcut is written next to the sidebar's Search row. */
export const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K'

/** Ctrl+K, or Cmd+K on a Mac (where Ctrl+K already means "delete to end of line" in text fields). */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  if (e.key?.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return false
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** A plain letter key, with no modifier held. */
export function isPlainKey(e: KeyboardEvent, letter: string): boolean {
  return e.key?.toLowerCase() === letter && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

/** True while the keyboard is being used to type into a field. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** True while a dialog, drawer or modal covers the page. The kit's dialogs and drawers carry
 * role="dialog"; the older Trading modals are only recognisable by their full-screen overlay. */
export function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [aria-modal="true"], .fixed.inset-0.z-50') !== null
}
