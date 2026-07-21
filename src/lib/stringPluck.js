import { playNote } from './audioEngine'

/**
 * stringPluck — single-string notes for the homepage pluckable strings and the
 * tuner's tap-to-hear-open-string feature. It delegates to the shared
 * audioEngine.playNote(), so these use the EXACT same rich guitar voice (real
 * acoustic sampler when installed, warm FM fallback otherwise) and reverb tail
 * as the chords in the Capo Calculator — a full, ringing note, not a tiny blip.
 */

// Major-pentatonic across a couple of octaves — any random pick sounds pleasant.
const PENTA = ['C', 'D', 'E', 'G', 'A']
const OCTAVES = [3, 4]
const NOTE_POOL = OCTAVES.flatMap((o) => PENTA.map((n) => `${n}${o}`))

/** Play a specific note (e.g. 'E2', 'A3') as a ringing single string. */
export async function pluckNote(note, velocity = 0.85) {
  await playNote(note, '2n', velocity)
}

/** Play a random pleasant pentatonic note. Returns the note played. */
export async function pluckRandom(velocity = 0.85) {
  const note = NOTE_POOL[(Math.random() * NOTE_POOL.length) | 0]
  await pluckNote(note, velocity)
  return note
}
