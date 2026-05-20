import { useEffect, useCallback } from 'react'

export interface KeyBinding {
  key: string
  action: () => void
  /** Don't fire when an input/textarea is focused */
  ignoreWhenTyping?: boolean
}

/**
 * Registers keyboard event listeners for kiosk-mode keyboard navigation.
 */
export function useKeyboardNav(bindings: KeyBinding[]) {
  const handler = useCallback((ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement
    const isTyping = ['INPUT', 'TEXTAREA'].includes(target.tagName)

    for (const binding of bindings) {
      if (binding.ignoreWhenTyping && isTyping) continue
      if (ev.code === binding.key || ev.key === binding.key) {
        ev.preventDefault()
        binding.action()
        return
      }
    }
  }, [bindings])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])
}
