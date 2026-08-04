import * as Tone from 'tone'

/**
 * audioUnlock — the single place that owns the browser's autoplay gate.
 *
 * Browsers keep the AudioContext suspended until the user makes a REAL gesture
 * (pointerdown / touch / key / click). Hovering a string is NOT one. Before that
 * first gesture, `ctx.resume()` returns a promise that never settles in Chrome
 * and Safari — so any code that `await`s it stalls forever, and every sound
 * scheduled behind that await fires in one burst the moment something else
 * finally unlocks the context. (That is exactly the "every hover I did on the
 * homepage played at once when I opened Magic Chords" bug.)
 *
 * The rule this module enforces: never await a resume outside a gesture. Sounds
 * asked for before the first gesture are DROPPED, not queued — which is also
 * what the browser would have done anyway.
 */

let gestured = false
let installed = false

// Every gesture kind, capture-phase, so we resume BEFORE React's own handlers
// run — the click that asks for a chord also unlocks the context.
const GESTURES = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click']

function ctxState() {
  try {
    return Tone.getContext()?.state ?? 'suspended'
  } catch {
    return 'suspended'
  }
}

function onGesture() {
  gestured = true
  if (ctxState() === 'running') return
  // Fire-and-forget: we are inside the gesture task, the only moment the
  // browser honours a resume. Nothing awaits this promise.
  Tone.start().catch(() => {})
}

/**
 * Listen for the first (and every later) user gesture and resume the audio
 * context there. Listeners stay attached for the life of the page: iOS suspends
 * the context again on interruptions and backgrounding, and the next tap has to
 * bring it back. Safe to call more than once.
 */
export function installAudioUnlock() {
  if (installed || typeof window === 'undefined') return
  installed = true
  for (const type of GESTURES) {
    window.addEventListener(type, onGesture, { capture: true, passive: true })
  }
  // Coming back from a backgrounded tab can leave the context suspended; the
  // next gesture fixes it, but try opportunistically once we're visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && gestured) onGesture()
  })
}

/** Has the user interacted yet? Only then may we await a context resume. */
export function isAudioAllowed() {
  return gestured || ctxState() === 'running'
}

/** Is the context actually running right now (i.e. will scheduled notes sound)? */
export function isAudioRunning() {
  return ctxState() === 'running'
}

/**
 * Await `p`, but give up after `ms`. Used to make sure a resume that never
 * settles cannot latch a boot promise pending forever.
 */
export function withTimeout(p, ms) {
  return Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))])
}
