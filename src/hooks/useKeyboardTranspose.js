import { useEffect } from 'react'

/**
 * useKeyboardTranspose — global + / - shortcuts for the transposer.
 * Ignores keystrokes while typing in inputs/textareas.
 */
export default function useKeyboardTranspose({ onUp, onDown, onReset }) {
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        onUp()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        onDown()
      } else if (e.key === '0' && onReset) {
        e.preventDefault()
        onReset()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onUp, onDown, onReset])
}
