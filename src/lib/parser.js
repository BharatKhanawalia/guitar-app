import ChordSheetJS from 'chordsheetjs'
import { isChord } from './chordTheory'

/**
 * parser.js — turn raw "Ultimate Guitar" style text (chords positioned above
 * lyrics) into a structured, render-ready model using ChordSheetJS.
 *
 * Output model:
 *   { lines: [ { type, pairs: [ { chord, lyrics } ] } ] }
 * where `type` is 'lyric' | 'blank' | 'section'.
 */

/**
 * Is this raw line a guitar TAB line (e|--12--13h15--|) or a fret-number line?
 * These must NEVER be transposed — the leading string letters (E A D G B e) look
 * like chords and would get mangled ("E" → "Eb"). We detect them and pass them
 * through verbatim.
 */
export function isTabLine(line) {
  const t = line.trim()
  if (t.length < 4 || !t.includes('|')) return false
  // string letter (optional) then a bar, then tab content
  const leadsLikeTab = /^[eEbBgGdDaA]{0,2}\s*[|:]/.test(t)
  // proportion of characters that are tab notation (dashes, pipes, digits, h/p/b/etc.)
  const tabChars = (t.match(/[-|0-9hpbrsx*/\\~()t.]/g) || []).length
  const ratio = tabChars / t.length
  return (leadsLikeTab && ratio > 0.5) || ratio > 0.6
}

// Extract the {type, pairs} model for one ChordSheetJS-parsed segment.
function linesFromSong(song) {
  return song.lines.map((line) => {
    const pairs = line.items
      .filter((item) => item && typeof item === 'object' && 'lyrics' in item)
      .map((item) => ({
        chord: item.chords ? item.chords.trim() : '',
        lyrics: item.lyrics != null ? item.lyrics : '',
      }))

    const hasChords = pairs.some((p) => p.chord)
    const hasLyrics = pairs.some((p) => p.lyrics.trim())

    let type = 'lyric'
    if (!hasChords && !hasLyrics) type = 'blank'
    else if (!hasChords && /^\s*\[.*\]\s*$/.test(pairs.map((p) => p.lyrics).join(''))) {
      type = 'section'
    }
    return { type, pairs }
  })
}

export function parseChordSheet(raw) {
  if (!raw || !raw.trim()) return { lines: [] }

  // Segment out TAB lines so ChordSheetJS never touches them (they'd be parsed as
  // chords and transposed). Everything else is chord/lyric prose, parsed normally.
  const rawLines = raw.replace(/\r/g, '').split('\n')
  const out = []
  let buffer = []
  const flush = () => {
    if (!buffer.length) return
    const text = buffer.join('\n')
    try {
      out.push(...linesFromSong(new ChordSheetJS.ChordsOverWordsParser().parse(text)))
    } catch {
      out.push(...naiveParse(text).lines)
    }
    buffer = []
  }
  for (const rl of rawLines) {
    if (isTabLine(rl)) {
      flush()
      out.push({ type: 'tab', text: rl, pairs: [] })
    } else {
      buffer.push(rl)
    }
  }
  flush()

  return { lines: out }
}

/** Very defensive fallback: pair each chord-line with the following lyric-line. */
function naiveParse(raw) {
  const rows = raw.replace(/\r/g, '').split('\n')
  const lines = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.trim()) {
      lines.push({ type: 'blank', pairs: [] })
      continue
    }
    const tokens = row.trim().split(/\s+/)
    const looksLikeChords = tokens.length > 0 && tokens.every((t) => isChord(t))
    if (looksLikeChords) {
      lines.push({ type: 'lyric', pairs: tokens.map((c) => ({ chord: c, lyrics: '' })) })
    } else {
      lines.push({ type: 'lyric', pairs: [{ chord: '', lyrics: row }] })
    }
  }
  return { lines }
}

/** Collect the unique set of chord symbols used in a parsed sheet. */
export function collectChords(model) {
  const set = new Set()
  for (const line of model.lines) {
    for (const pair of line.pairs) {
      if (pair.chord && isChord(pair.chord)) set.add(pair.chord)
    }
  }
  return [...set]
}

export const SAMPLE_SHEET = `[Verse 1]
G                 D
Well I heard there was a
Em            C
secret chord that David played
G              D
and it pleased the Lord
Em                 C
but you don't really care for music, do you?

[Chorus]
C            Em
Hallelujah,  Hallelujah
C          G       D  G
Hallelujah, Halle -  lu - jah`
