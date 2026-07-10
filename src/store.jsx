import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { SAMPLE_SHEET } from './lib/parser'

/**
 * store.jsx — a tiny global state container for CapoFlow.
 *
 * Why this exists: switching tabs unmounts each page, which used to wipe the
 * pasted chord sheet and the picked progression back to their placeholders.
 * We lift every piece of cross-tab state up here, above the tab switch, and
 * mirror it into sessionStorage so it survives soft navigation and even an
 * accidental refresh — a *hard* reload (new tab / cleared session) starts fresh.
 *
 * Deliberately dependency-free (no Zustand/Redux): one Context, one persisted
 * object, plain setters. Instant, synchronous, client-side.
 */

const KEY = 'capoflow.v1'

const DEFAULTS = {
  chords: ['C', 'G', 'Am', 'F'], // Capo Optimizer progression
  sheet: SAMPLE_SHEET, // Sheet Transposer raw text
  preferFlats: false, // enharmonic spelling: false = sharps (#), true = flats (♭)
  semitones: 0, // Sheet Transposer transpose offset
  simplify: false, // Sheet Transposer "simplify to triads"
}

function load() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    // Merge so newly-added keys always have a default.
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, setState] = useState(load)

  // Persist the whole blob whenever it changes (debounced to the next frame).
  const frame = useRef(null)
  useEffect(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(state))
      } catch {
        /* storage full / private mode — non-fatal, state still lives in memory */
      }
    })
    return () => cancelAnimationFrame(frame.current)
  }, [state])

  // Generic field setter that also accepts an updater fn, mirroring useState.
  const set = (key) => (value) =>
    setState((s) => ({
      ...s,
      [key]: typeof value === 'function' ? value(s[key]) : value,
    }))

  const value = {
    ...state,
    setChords: set('chords'),
    setSheet: set('sheet'),
    setPreferFlats: set('preferFlats'),
    setSemitones: set('semitones'),
    setSimplify: set('simplify'),
    reset: () => setState({ ...DEFAULTS }),
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
