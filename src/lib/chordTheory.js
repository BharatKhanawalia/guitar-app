import { Chord, Note, Interval, Key } from 'tonal'

/**
 * chordTheory.js — the music-theory engine for CapoFlow.
 * All logic is pure & synchronous so transposition is instantaneous and client-side.
 */

export const SHARP_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLAT_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Roots whose natural open shape rings out beautifully. */
const OPEN_MAJOR = new Set(['C', 'A', 'G', 'E', 'D'])
const OPEN_MINOR = new Set(['E', 'A', 'D']) // Em, Am, Dm
const OPEN_DOM7 = new Set(['C', 'A', 'G', 'E', 'D', 'B']) // C7 A7 G7 E7 D7 B7
const OPEN_MIN7 = new Set(['E', 'A', 'D']) // Em7 Am7 Dm7

/** Chords that are commonly played as a full barre — heavy penalty. */
const HARD_BARRE_ROOTS = new Set(['F', 'F#', 'Gb', 'Bb', 'B'])

/**
 * Parse a raw chord token (e.g. "C#m7", "Bb", "F#m/A") into a normalized descriptor.
 * Returns null for non-chord tokens so the parser can leave them untouched.
 */
export function parseChord(token) {
  if (!token) return null
  const clean = token.trim()
  // Split a slash / inversion bass note off first.
  const [main, bass] = clean.split('/')
  const info = Chord.get(main)
  if (info.empty || !info.tonic) return null
  return {
    raw: clean,
    tonic: info.tonic,
    quality: info.quality, // 'Major' | 'Minor' | 'Augmented' | 'Diminished' | 'Unknown'
    type: info.type, // e.g. 'major', 'minor seventh'
    aliases: info.aliases,
    symbol: info.symbol || main,
    bass: bass || null,
  }
}

/** Is a raw token actually a chord? */
export function isChord(token) {
  return parseChord(token) !== null
}

/**
 * Transpose a single chord symbol by a number of semitones.
 * Preserves the suffix (m7, sus4, add9…) and any slash-bass note.
 * `preferFlats` chooses spelling (Bb vs A#).
 */
export function transposeChord(symbol, semitones, preferFlats = false) {
  const parsed = parseChord(symbol)
  if (!parsed) return symbol
  // NB: we intentionally do NOT early-return at semitones === 0 — even with no
  // transposition we must still re-spell accidentals to honor the ♭/♯ toggle
  // (e.g. capo 0 / +0 transpose must turn F# into Gb when flats are preferred).

  const interval = Interval.fromSemitones(((semitones % 12) + 12) % 12)
  const newTonicRaw = Note.transpose(parsed.tonic, interval)
  const newTonic = respell(newTonicRaw, preferFlats)

  // Everything after the tonic in the original symbol is the suffix.
  const suffix = parsed.symbol.slice(parsed.tonic.length)
  let out = newTonic + suffix

  if (parsed.bass) {
    const newBass = respell(Note.transpose(parsed.bass, interval), preferFlats)
    out += '/' + newBass
  }
  return out
}

/**
 * Re-spell a chord symbol's accidentals (root + slash bass) to the sharp/flat
 * convention WITHOUT transposing it. Used to instantly re-render every chord on
 * screen when the ♭/♯ toggle flips (e.g. F# ⇄ Gb, D#m ⇄ Ebm).
 */
export function respellChord(symbol, preferFlats = false) {
  const p = parseChord(symbol)
  if (!p) return symbol
  const root = respell(p.tonic, preferFlats)
  const suffix = p.symbol.slice(p.tonic.length)
  let out = root + suffix
  if (p.bass) out += '/' + respell(p.bass, preferFlats)
  return out
}

/** Normalize enharmonic spelling to sharp or flat convention. */
export function respell(note, preferFlats) {
  const midi = Note.chroma(note)
  if (midi == null) return note
  return preferFlats ? FLAT_KEYS[midi] : SHARP_KEYS[midi]
}

/**
 * Difficulty of a single chord as guitar shape.
 * Returns { score, tag } where higher score = easier.
 *   open  : +3   (rings, uses open strings)
 *   easy  : +1   (open-ish 7ths)
 *   medium:  0   (movable but manageable)
 *   barre : -3   (full barre)
 */
export function chordDifficulty(symbol) {
  const p = parseChord(symbol)
  if (!p) return { score: 0, tag: 'other' }
  const root = respell(p.tonic, false) // normalize to sharp for set lookup
  const t = p.type

  const isMajorTriad = t === 'major'
  const isMinorTriad = t === 'minor'
  const isDom7 = t === 'dominant seventh'
  const isMin7 = t === 'minor seventh'
  const isMaj7 = t === 'major seventh'

  if (isMajorTriad && OPEN_MAJOR.has(root)) return { score: 3, tag: 'open' }
  if (isMinorTriad && OPEN_MINOR.has(root)) return { score: 3, tag: 'open' }
  if (isDom7 && OPEN_DOM7.has(root)) return { score: 1.5, tag: 'easy' }
  if (isMin7 && OPEN_MIN7.has(root)) return { score: 1.5, tag: 'easy' }
  if (isMaj7 && OPEN_MAJOR.has(root)) return { score: 1.5, tag: 'easy' }

  // G/B, D/F# style open-friendly slash chords stay easy.
  if (isMajorTriad && (root === 'F' || root === 'B')) return { score: -3, tag: 'barre' }
  if (HARD_BARRE_ROOTS.has(root)) return { score: -2.5, tag: 'barre' }

  // Movable minor / seventh shapes elsewhere: mild penalty.
  if (isMinorTriad || isMin7) return { score: -1.5, tag: 'barre' }
  if (isMajorTriad) return { score: -1, tag: 'medium' }

  return { score: -0.5, tag: 'medium' }
}

/**
 * Score a whole progression's playability. Higher = easier.
 * Also returns a breakdown for the UI badges.
 */
export function scoreProgression(chords) {
  let score = 0
  let openCount = 0
  let barreCount = 0
  for (const c of chords) {
    const d = chordDifficulty(c)
    score += d.score
    if (d.tag === 'open') openCount++
    if (d.tag === 'barre') barreCount++
  }
  return { score, openCount, barreCount, total: chords.length }
}

/**
 * THE CAPO OPTIMIZER.
 * Given the chords a song is written in, compute how it feels to play at
 * every capo position 0..maxFret. A capo on fret N raises pitch by N semitones,
 * so to keep the song sounding identical you finger shapes transposed DOWN by N.
 *
 * Returns an array sorted by playability (best first), each entry:
 *   { capo, chords, score, openCount, barreCount, recommended }
 */
export function optimizeCapo(inputChords, maxFret = 11, preferFlats = false) {
  const chords = inputChords.map((c) => c.trim()).filter(Boolean)
  if (chords.length === 0) return []

  const results = []
  for (let capo = 0; capo <= maxFret; capo++) {
    const shaped = chords.map((c) => transposeChord(c, -capo, preferFlats))
    const s = scoreProgression(shaped)
    results.push({
      capo,
      chords: shaped,
      score: Number(s.score.toFixed(2)),
      openCount: s.openCount,
      barreCount: s.barreCount,
      total: s.total,
    })
  }

  // Keep capo order for the comparison grid, but flag the winner.
  const best = [...results].sort(
    (a, b) => b.score - a.score || b.openCount - a.openCount || a.capo - b.capo,
  )[0]

  return results
    .map((r) => ({ ...r, recommended: r.capo === best.capo }))
    .sort((a, b) => a.capo - b.capo)
}

/** Rank list variant — sorted best→worst, used for the "top picks" strip. */
export function rankedCapos(inputChords, maxFret = 11, preferFlats = false) {
  return [...optimizeCapo(inputChords, maxFret, preferFlats)].sort(
    (a, b) => b.score - a.score || b.openCount - a.openCount || a.capo - b.capo,
  )
}

/** Simplify a complex chord to its base triad, e.g. Cmaj13 → C, Am7b5 → Am. */
export function simplifyChord(symbol) {
  const p = parseChord(symbol)
  if (!p) return symbol
  const root = p.tonic
  const t = p.type
  let suffix = ''
  if (t.includes('minor') || p.quality === 'Minor') suffix = 'm'
  else if (t.includes('diminished')) suffix = 'dim'
  else if (t.includes('augmented')) suffix = 'aug'
  // major / dominant / suspended all collapse to the plain major triad.
  return root + suffix
}

/* ------------------------------------------------------------------ */
/* Key detection                                                       */
/* ------------------------------------------------------------------ */

/** Coarse quality class of a chord for key-matching: 'maj' | 'min' | 'dim' | 'aug'. */
function qualityClass(type, quality) {
  if (type.includes('diminished') || quality === 'Diminished') return 'dim'
  if (type.includes('augmented') || quality === 'Augmented') return 'aug'
  if (type.includes('minor') || quality === 'Minor') return 'min'
  return 'maj' // major, dominant, suspended, add, 6/9 … all read as "major-ish"
}

/** Reduce a triad symbol like "Bdim" / "Dm" to { pc, cls }. */
function triadToken(sym) {
  const c = Chord.get(sym)
  if (c.empty || !c.tonic) return null
  const pc = Note.chroma(c.tonic)
  if (pc == null) return null
  return { pc, cls: qualityClass(c.type, c.quality) }
}

/** Build the diatonic-triad fingerprint of a key as a Set of "pc:cls" strings. */
function keyFingerprint(tonic, mode) {
  let triads = []
  if (mode === 'major') {
    triads = Key.majorKey(tonic).triads
  } else {
    const mk = Key.minorKey(tonic)
    // Union natural + harmonic so V (major dominant) and bVII both count.
    triads = [...mk.natural.triads, ...mk.harmonic.triads]
  }
  const set = new Set()
  for (const t of triads) {
    const tok = triadToken(t)
    if (tok) set.add(`${tok.pc}:${tok.cls}`)
  }
  return set
}

const CHROMA_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Detect the most probable key of a progression by scoring every major & minor
 * key against the chords actually used. Confidence reflects how cleanly the
 * chords sit inside the winning key, nudged by tonal-gravity cues (the tonic
 * appearing, and the song starting or ending on it).
 *
 * Returns { tonic, mode, label, confidence } or null. Callers should hide the
 * key badge when `confidence` is low (< ~0.5) to avoid asserting bad theory.
 */
export function detectKey(chords) {
  const toks = chords.map(parseChord).filter(Boolean).map((p) => ({
    pc: Note.chroma(p.tonic),
    cls: qualityClass(p.type, p.quality),
    raw: p,
  })).filter((t) => t.pc != null)

  if (toks.length < 2) return null // one chord tells us nothing reliable

  const firstPc = toks[0].pc
  const lastPc = toks[toks.length - 1].pc

  let best = null
  let runnerUpScore = 0

  for (let pc = 0; pc < 12; pc++) {
    for (const mode of ['major', 'minor']) {
      const tonic = CHROMA_ROOTS[pc]
      const fp = keyFingerprint(tonic, mode)

      let inKey = 0
      let tonicPresent = false
      for (const t of toks) {
        if (fp.has(`${t.pc}:${t.cls}`)) inKey++
        const wantCls = mode === 'major' ? 'maj' : 'min'
        if (t.pc === pc && t.cls === wantCls) tonicPresent = true
      }

      let score = inKey / toks.length // base: fraction of chords that fit
      if (tonicPresent) score += 0.15 // the tonic chord is actually played
      if (firstPc === pc) score += 0.08 // songs tend to start on I / i
      if (lastPc === pc) score += 0.12 // …and resolve to it

      if (!best || score > best.score) {
        runnerUpScore = best ? best.score : 0
        best = { tonic, mode, score, inKey }
      } else if (score > runnerUpScore) {
        runnerUpScore = score
      }
    }
  }

  if (!best) return null

  // Confidence: how well it fits AND how decisively it beat the runner-up.
  const margin = best.score - runnerUpScore
  const confidence = Math.max(0, Math.min(1, best.score * 0.8 + margin * 1.6))

  return {
    tonic: respell(best.tonic, false),
    mode: best.mode,
    label: respell(best.tonic, false) + (best.mode === 'minor' ? 'm' : ''),
    confidence: Number(confidence.toFixed(2)),
  }
}
