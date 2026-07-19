/**
 * beatGrid.js — turn tracked beats + chord segments into a bar grid whose
 * DOWNBEATS stay locked to the music, even across long instrumental intros.
 *
 * Why this exists
 * ---------------
 * The old approach marked a downbeat as `cellIndex % meter === phase` — one
 * global phase for the whole song. That silently assumes the beat tracker never
 * adds or drops a single beat from start to finish. It always does (sparse onsets
 * in a long intro are ambiguous), and every single dropped beat permanently
 * shifts EVERY downstream bar by one cell — the classic "diagonal slide" where
 * the chord lands one column later on each successive row.
 *
 * The fix: don't count beats modulo-meter. Instead:
 *   1. Seed on the strongest chord change (long, stable chords almost always
 *      begin on beat "one").
 *   2. March bar-to-bar by PREDICTED TIME (lastDownbeat + meter · localPeriod),
 *      which follows tempo and rides straight through held chords.
 *   3. RE-ANCHOR each predicted bar line to a real chord change if one sits
 *      within half a bar. A locally miscounted beat can no longer accumulate —
 *      the next real chord change snaps the grid back onto the music.
 */

/** Median of an array (returns 0 for empty). Non-mutating. */
function median(arr) {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  return a[a.length >> 1]
}

/**
 * Assign a boolean `downbeat` to every cell.
 * @param {{start:number,end:number,index:number}[]} cells - one per tracked beat
 * @param {{start:number,end:number,chord:string}[]} segments - chord segments
 * @param {number} meter - beats per bar (4 or 3)
 * @param {number} beatShift - whole-beat manual nudge of the "one"
 * @param {number} bpm - fallback tempo when beat deltas are unusable
 * @returns {boolean[]} isDown, indexed by cell index
 */
export function assignDownbeats(cells, segments, meter = 4, beatShift = 0, bpm = 120) {
  const n = cells.length
  const isDown = new Array(n).fill(false)
  if (n === 0) return isDown
  if (n < meter + 1) {
    isDown[0] = true
    return isDown
  }

  const fallbackPeriod = median(cells.slice(1).map((c, i) => c.start - cells[i].start)) || 60 / (bpm || 120)

  // Local (drift-following) beat period around a cell index.
  const periodAt = (i) => {
    const lo = Math.max(1, i - 3)
    const hi = Math.min(n - 1, i + 3)
    const d = []
    for (let k = lo; k <= hi; k++) d.push(cells[k].start - cells[k - 1].start)
    return median(d) || fallbackPeriod
  }

  // Nearest cell index to a time.
  const nearestIdx = (t) => {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(cells[i].start - t)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  // Chord-change weight per cell (weight = duration of the chord it starts, so a
  // long stable chord decides a bar line and a one-beat blip barely counts).
  const changeWeight = new Array(n).fill(0)
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (s.start > 0.1 && (i === 0 || segments[i - 1].chord !== s.chord)) {
      changeWeight[nearestIdx(s.start)] += Math.max(0.2, s.end - s.start)
    }
  }

  // Seed: the heaviest chord change (a strong, near-certain downbeat). If there
  // are no changes at all, fall back to the first beat.
  let seed = 0
  let seedW = -1
  for (let i = 0; i < n; i++) {
    if (changeWeight[i] > seedW) {
      seedW = changeWeight[i]
      seed = i
    }
  }

  // Manual nudge: shift which beat is "one", kept in range.
  seed += Math.round(beatShift)
  while (seed < 0) seed += meter
  while (seed >= n) seed -= meter
  if (seed < 0) seed = 0

  // Find the next bar line: predict by time, then re-anchor to a nearby change.
  const step = (idx, dir) => {
    const p = periodAt(idx)
    const predT = cells[idx].start + dir * meter * p
    const tol = p * (meter / 2) // half a bar
    // Prefer snapping to the strongest chord change within half a bar of predT.
    let best = -1
    let bestW = 0
    for (let j = 0; j < n; j++) {
      if (dir > 0 ? j <= idx + 1 : j >= idx - 1) continue
      const dt = cells[j].start - predT
      if (Math.abs(dt) > tol) continue
      if (changeWeight[j] > bestW) {
        bestW = changeWeight[j]
        best = j
      }
    }
    if (best >= 0) return best
    // No change nearby: take the beat closest to the predicted time, at least two
    // beats away so bars never collapse.
    let ni = -1
    let nd = Infinity
    for (let j = 0; j < n; j++) {
      if (dir > 0 ? j < idx + 2 : j > idx - 2) continue
      const d = Math.abs(cells[j].start - predT)
      if (d < nd) {
        nd = d
        ni = j
      }
    }
    return ni
  }

  isDown[seed] = true
  for (let idx = seed; idx >= 0 && idx < n; ) {
    const nx = step(idx, +1)
    if (nx <= idx || nx >= n) break
    isDown[nx] = true
    idx = nx
  }
  for (let idx = seed; idx > 0; ) {
    const pv = step(idx, -1)
    if (pv < 0 || pv >= idx) break
    isDown[pv] = true
    idx = pv
  }
  return isDown
}

/**
 * Build the Phrase Ribbon model: rows of time-elastic chord blocks.
 *
 * Each row is a musical PHRASE. Block width is proportional to duration, so the
 * picture is intrinsically the timing. Row boundaries come, in priority order:
 *   1. `lineBreaks` — explicit phrase-start times (e.g. Whisper lyric-line onsets).
 *      This is what guarantees "first word → first chord block".
 *   2. otherwise, group `barsPerPhrase` detected bars per row.
 *
 * @param {{start:number,end:number,chord:string}[]} segments
 * @param {number[]} barStarts - downbeat times (row[0].start of each bar)
 * @param {number} duration
 * @param {object} [opts] - { lineBreaks?: number[], barsPerPhrase?: number }
 * @returns {{start:number,end:number,blocks:{chord:string,start:number,end:number}[]}[]}
 */
export function buildPhrases(segments, barStarts, duration, opts = {}) {
  if (!segments || !segments.length || duration <= 0) return []
  const barsPerPhrase = opts.barsPerPhrase || 4

  // 1. Determine phrase boundary TIMES.
  let bounds
  if (opts.lineBreaks && opts.lineBreaks.length) {
    bounds = [...new Set(opts.lineBreaks.filter((t) => t >= 0 && t < duration))].sort((a, b) => a - b)
    if (bounds[0] > 0.25) bounds.unshift(0)
  } else if (barStarts && barStarts.length) {
    bounds = []
    for (let i = 0; i < barStarts.length; i += barsPerPhrase) bounds.push(barStarts[i])
    if (bounds[0] > 0.25) bounds.unshift(0)
  } else {
    bounds = [0]
  }
  bounds = bounds.filter((t) => t < duration)
  if (!bounds.length) bounds = [0]

  // 2. For each [bound, nextBound) window, clip the chord segments into blocks.
  const rows = []
  for (let i = 0; i < bounds.length; i++) {
    const rowStart = bounds[i]
    const rowEnd = i + 1 < bounds.length ? bounds[i + 1] : duration
    if (rowEnd - rowStart < 0.05) continue
    const blocks = []
    for (const s of segments) {
      const bs = Math.max(s.start, rowStart)
      const be = Math.min(s.end, rowEnd)
      if (be - bs < 0.04) continue
      // merge consecutive identical chords
      const last = blocks[blocks.length - 1]
      if (last && last.chord === s.chord && bs - last.end < 0.06) last.end = be
      else blocks.push({ chord: s.chord, start: bs, end: be })
    }
    if (blocks.length) rows.push({ start: rowStart, end: rowEnd, blocks })
  }
  return rows
}
