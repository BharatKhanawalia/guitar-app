import { Note } from 'tonal'
import { parseChord, respell } from './chordTheory'

/**
 * chordShapes.js — fretboard fingering data for the SVG diagrams.
 *
 * Shape format:
 *   frets:   [E A D G B e]  low→high. 0 = open, -1 = muted (x), n = fret number.
 *   fingers: optional finger numbers (1-4) aligned to frets.
 *   barre:   optional { fret, from, to } for a barre line.
 *   base:    lowest fret shown (for high-position shapes).
 */

// Curated library of the most common open / first-position shapes.
const LIBRARY = {
  C: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  C7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  D: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  D7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  Em7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 1, 0, 0, 0, 2] },
  A: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  A7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  B7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
}

// Open-string chroma of each string, low→high: E A D G B E
const STRING_CHROMA = [4, 9, 2, 7, 11, 4]

/** Find the lowest fret ≥ minFret on a string that produces target chroma. */
function fretForChroma(stringChroma, targetChroma, minFret = 0, maxFret = 14) {
  for (let f = minFret; f <= maxFret; f++) {
    if ((stringChroma + f) % 12 === targetChroma) return f
  }
  return null
}

/** Build a movable E-shape barre (root on the low-E string). */
function eShape(rootChroma, quality) {
  const f = fretForChroma(STRING_CHROMA[0], rootChroma, 1, 12)
  if (f == null) return null
  const offsets =
    quality === 'minor'
      ? [0, 2, 2, 0, 0, 0]
      : quality === 'dom7'
        ? [0, 2, 0, 1, 0, 0]
        : quality === 'min7'
          ? [0, 2, 0, 0, 0, 0]
          : [0, 2, 2, 1, 0, 0] // major
  const frets = offsets.map((o) => f + o)
  return { frets, barre: { fret: f, from: 0, to: 5 }, base: f, movable: true }
}

/** Build a movable A-shape barre (root on the A string, low-E muted). */
function aShape(rootChroma, quality) {
  const f = fretForChroma(STRING_CHROMA[1], rootChroma, 1, 12)
  if (f == null) return null
  const offsets =
    quality === 'minor'
      ? [null, 0, 2, 2, 1, 0]
      : quality === 'dom7'
        ? [null, 0, 2, 0, 2, 0]
        : quality === 'min7'
          ? [null, 0, 2, 0, 1, 0]
          : [null, 0, 2, 2, 2, 0] // major
  const frets = offsets.map((o) => (o == null ? -1 : f + o))
  return { frets, barre: { fret: f, from: 1, to: 5 }, base: f, movable: true }
}

/**
 * Resolve a chord symbol to a drawable shape.
 * Tries the curated library first (best spelling), then generates a barre shape,
 * preferring whichever position sits lower on the neck.
 */
export function getChordShape(symbol) {
  if (!symbol) return null
  // Direct hit (normalize slash-bass away for the diagram).
  const base = symbol.split('/')[0]
  if (LIBRARY[base]) return { ...LIBRARY[base], symbol: base }

  const p = parseChord(base)
  if (!p) return null

  // Try the enharmonic twin in the library too (e.g. Bb ↔ A#).
  const flat = respell(p.tonic, true) + base.slice(p.tonic.length)
  const sharp = respell(p.tonic, false) + base.slice(p.tonic.length)
  if (LIBRARY[flat]) return { ...LIBRARY[flat], symbol: base }
  if (LIBRARY[sharp]) return { ...LIBRARY[sharp], symbol: base }

  const rootChroma = Note.chroma(p.tonic)
  if (rootChroma == null) return null

  let quality = 'major'
  if (p.type === 'minor') quality = 'minor'
  else if (p.type === 'dominant seventh') quality = 'dom7'
  else if (p.type === 'minor seventh') quality = 'min7'
  else if (p.type.includes('minor')) quality = 'minor'

  const e = eShape(rootChroma, quality)
  const a = aShape(rootChroma, quality)
  const candidates = [e, a].filter(Boolean)
  if (candidates.length === 0) return null
  // Prefer the shape whose barre fret is lowest (comfier), tie-break to E-shape.
  candidates.sort((x, y) => x.base - y.base)
  return { ...candidates[0], symbol: base }
}
