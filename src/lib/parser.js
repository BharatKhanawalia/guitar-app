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

export function parseChordSheet(raw) {
  if (!raw || !raw.trim()) return { lines: [] }

  let song
  try {
    // ChordsOverWordsParser is the modern replacement for the deprecated
    // ChordSheetParser — same chords-above-lyrics model, wider chord support.
    song = new ChordSheetJS.ChordsOverWordsParser().parse(raw)
  } catch {
    // Fall back to a naive parse if ChordSheetJS chokes on odd input.
    return naiveParse(raw)
  }

  const lines = song.lines.map((line) => {
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

  return { lines }
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
