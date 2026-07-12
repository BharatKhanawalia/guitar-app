/**
 * sheet.js — turn detected chord segments (+ optional pasted lyrics) into a
 * line/column model shared by the Lyrics tab and the PDF/DOCX exporters.
 *
 * Honest scope note: fully-automatic lyric transcription (Whisper-tiny in-browser)
 * is ~40 MB of model fetched at runtime and unreliable on music, so we don't fake
 * it. Instead: the chords are always real & timed; lyrics are OPTIONAL — the user
 * pastes them, and we distribute chords across the lyric lines proportionally,
 * anchoring each chord to a character column so it renders directly above a word.
 *
 * Output line shape:  { chords: [{ chord, col, index }], text: string }
 *   - `index` is the segment index, so the UI can wave the active chord.
 *   - `col`   is the character column the chord sits above (monospace alignment).
 */
export function buildSheet(segments, lyricsText = '') {
  if (!segments?.length) return []

  const lyricLines = lyricsText
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === '')) // collapse double blanks

  // No lyrics → flow the chords into tidy rows of 4.
  if (!lyricLines.some((l) => l.trim())) {
    const rows = []
    const PER = 4
    for (let i = 0; i < segments.length; i += PER) {
      const slice = segments.slice(i, i + PER)
      let col = 0
      const chords = slice.map((s, j) => {
        const c = { chord: s.chord, col, index: i + j }
        col += Math.max(s.chord.length + 3, 8)
        return c
      })
      rows.push({ chords, text: '' })
    }
    return rows
  }

  // With lyrics → spread chords across the non-empty lyric lines proportionally.
  const singable = lyricLines.map((t, i) => ({ t, i })).filter((x) => x.t.trim())
  const perLine = Math.max(1, Math.round(segments.length / singable.length))

  const out = lyricLines.map((t) => ({ chords: [], text: t }))
  let seg = 0
  for (const { i, t } of singable) {
    const count = Math.min(perLine, segments.length - seg)
    const words = t.length
    for (let k = 0; k < count && seg < segments.length; k++, seg++) {
      // Spread chord anchors evenly across the width of the lyric line.
      const col = count > 1 ? Math.round((k / count) * Math.max(0, words - 2)) : 0
      out[i].chords.push({ chord: segments[seg].chord, col, index: seg })
    }
  }
  // Any leftover chords (rounding) tacked onto the last singable line.
  while (seg < segments.length) {
    const lastIdx = singable[singable.length - 1].i
    const line = out[lastIdx]
    const col = (line.chords[line.chords.length - 1]?.col || 0) + 8
    line.chords.push({ chord: segments[seg].chord, col, index: seg })
    seg++
  }
  return out
}
