import { useEffect, useState } from 'react'
import { isAudioAllowed, onAudioUnlock } from '../lib/audioUnlock'

/**
 * True once the browser will let us make a sound — i.e. after the user's first
 * gesture (or immediately, on an origin the browser already trusts). Lets the
 * UI ask for that first click instead of leaving a hover mysteriously silent.
 */
export default function useAudioUnlocked() {
  const [unlocked, setUnlocked] = useState(() => isAudioAllowed())
  useEffect(() => {
    if (unlocked) return undefined
    return onAudioUnlock(() => setUnlocked(true))
  }, [unlocked])
  return unlocked
}
