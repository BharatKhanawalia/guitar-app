import ort from 'onnxruntime-node'
import { mdxSeparate } from '../src/lib/mdx.js'
import { analyzePcm } from '../src/lib/chordDetect.js'
import { respellChord, parseChord } from '../src/lib/chordTheory.js'
import { spawnSync } from 'node:child_process'

const SR = 44100
const MODEL = 'models/UVR-MDX-NET-Inst_HQ_3.onnx'
const ALL = {
  'trimmed1.mp3': ['Am', 'G', 'F'],
  'trimmed2.wav': ['Fm', 'Bbm', 'Eb', 'Ab', 'F', 'Bb'],
  '3idiots.mp3': ['C', 'F', 'G'],
  'beatles.mp3': ['F#m', 'C#m', 'A', 'B', 'E', 'G#m', 'Gm', 'Dm', 'Bb', 'C', 'F', 'D'],
}
const only = process.env.FILE
const TRUTH = Object.fromEntries(Object.entries(ALL).filter(([f]) => !only || f.includes(only)))
const canon = (s) => (parseChord(s) ? respellChord(s, false) : s)

function decode(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'public/' + file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4))
}
async function coverage(data, truthSet) {
  const res = await analyzePcm(data, SR, { engine: 'accurate' })
  let tot = 0, cov = 0
  const hist = new Map()
  for (const s of res.segments) {
    const d = s.end - s.start; tot += d
    const c = canon(s.chord); hist.set(c, (hist.get(c) || 0) + d)
    if (truthSet.has(c)) cov += d
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, t]) => `${truthSet.has(c) ? '✓' : '✗'}${c}${t.toFixed(0)}`).join(' ')
  return { cov: tot ? (100 * cov / tot) : 0, key: res.key?.label, top }
}

const session = await ort.InferenceSession.create(MODEL)
console.log('model loaded:', MODEL, '\n')

for (const [file, truth] of Object.entries(TRUTH)) {
  const set = new Set(truth.map(canon))
  const mono = decode(file)
  process.stdout.write(`=== ${file} (${(mono.length / SR).toFixed(0)}s) — truth: ${truth.join(' ')}\n`)

  const before = await coverage(mono, set)
  console.log(`  BEFORE (raw mix):        key ${before.key}  cov ${before.cov.toFixed(1)}%   ${before.top}`)

  process.stdout.write('  separating (MDX)…\r')
  const inst = await mdxSeparate(mono, session, ort, () => {})
  const after = await coverage(inst, set)
  console.log(`  AFTER  (MDX instrument): key ${after.key}  cov ${after.cov.toFixed(1)}%   ${after.top}`)
  console.log(`  Δ coverage: ${(after.cov - before.cov >= 0 ? '+' : '') + (after.cov - before.cov).toFixed(1)} pts\n`)
}
