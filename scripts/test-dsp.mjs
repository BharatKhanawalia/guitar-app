#!/usr/bin/env node
/**
 * test-dsp.mjs — run lib/chordDetect against ground-truth audio in public/.
 *
 * Decodes each mp3 with ffmpeg (mono, 22.05 kHz, f32le) and feeds the PCM to the
 * exact browser DSP via analyzePcm(). Scores the detected chords (time-weighted)
 * against the known chords for each file so we can tune the math objectively.
 *
 *   node scripts/test-dsp.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { analyzePcm } from '../src/lib/chordDetect.js'
import { respellChord, parseChord } from '../src/lib/chordTheory.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUB = join(__dirname, '..', 'public')
const SR = 22050

// Ground truth: the actual rhythm chords in each trim (order = as they occur).
const TRUTH = {
  'trimmed1.mp3': { key: 'Am', chords: ['Am', 'G', 'F'] },
  'trimmed2.wav': { key: 'Fm', chords: ['Fm', 'Bbm', 'Eb', 'Ab', 'F', 'Bb'] },
  '3idiots.mp3': { key: 'C', chords: ['C', 'F', 'G'] },
  'beatles.mp3': { key: 'E', chords: ['F#m', 'C#m', 'A', 'B', 'E', 'G#m', 'Gm', 'Dm', 'Bb', 'C', 'F', 'D'] },
}

// Canonical pitch-class + quality so spelling (Bb vs A#) doesn't matter.
function canon(sym) {
  const p = parseChord(sym)
  if (!p) return sym
  const s = respellChord(sym, false) // sharp spelling
  return s
}

function decode(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  })
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr)
  const buf = r.stdout
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
}

async function run(file) {
  const path = join(PUB, file)
  if (!existsSync(path)) {
    console.log(`\n=== ${file} — MISSING (skipped) ===`)
    return
  }
  const truth = TRUTH[file]
  const truthSet = new Set(truth.chords.map(canon))
  const data = decode(path)
  const res = await analyzePcm(data, SR, { engine: 'accurate', preferFlats: /b/.test(truth.chords.join('')) })

  // Time-weighted coverage + histogram of detected chords.
  const hist = new Map()
  let total = 0
  let covered = 0
  for (const s of res.segments) {
    const dur = s.end - s.start
    total += dur
    const c = canon(s.chord)
    hist.set(c, (hist.get(c) || 0) + dur)
    if (truthSet.has(c)) covered += dur
  }
  const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1])

  console.log(`\n=== ${file} ===`)
  console.log(`  detected key: ${res.key ? res.key.label + ' (' + Math.round(res.key.confidence * 100) + '%)' : '—'}   bpm: ${res.bpm}   segments: ${res.segments.length}`)
  console.log(`  GROUND TRUTH chords: ${truth.chords.join(' ')}   (key ${truth.key})`)
  console.log(`  detected chords (by time):`)
  for (const [c, t] of sorted) {
    const inTruth = truthSet.has(c) ? '✓' : '✗'
    console.log(`     ${inTruth} ${c.padEnd(5)} ${(t).toFixed(1)}s  ${'█'.repeat(Math.round((t / total) * 40))}`)
  }
  const missing = [...truthSet].filter((c) => !hist.has(c))
  console.log(`  COVERAGE (time on a ground-truth chord): ${(100 * covered / total).toFixed(1)}%`)
  console.log(`  missing ground-truth chords: ${missing.length ? missing.join(', ') : 'none'}`)
  // Print the raw sequence (merged) so we can eyeball the progression.
  const seq = res.segments.map((s) => s.chord).filter((c, i, a) => c !== a[i - 1])
  console.log(`  sequence: ${seq.slice(0, 40).join(' ')}${seq.length > 40 ? ' …' : ''}`)
  if (process.env.DUMP) {
    console.log('  segments:')
    for (const s of res.segments) console.log(`     ${s.start.toFixed(1).padStart(5)}–${s.end.toFixed(1).padStart(5)}s  ${s.chord}`)
  }
}

const only = process.env.FILE
for (const f of Object.keys(TRUTH)) {
  if (only && !f.includes(only)) continue
  await run(f)
}
console.log('')
