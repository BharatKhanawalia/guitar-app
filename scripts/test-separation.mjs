import { stft, istft } from '../src/lib/separation.js'
import { spawnSync } from 'node:child_process'

// Real audio clip (first ~5s of 3idiots) decoded to mono 44.1k.
const r = spawnSync('ffmpeg', ['-v','error','-i','public/3idiots.mp3','-t','5','-ac','1','-ar','44100','-f','f32le','-'], { maxBuffer: 1<<30 })
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length/4))

const spec = stft(x)
const y = istft(spec)

// SNR over the interior (skip one FFT frame at each edge).
const N = 4096, lo = N, hi = Math.min(x.length, y.length) - N
let sig = 0, err = 0
for (let i = lo; i < hi; i++) { sig += x[i]*x[i]; const e = x[i]-y[i]; err += e*e }
const snr = 10 * Math.log10(sig / (err + 1e-12))
console.log(`STFT/ISTFT roundtrip on real audio: ${(hi-lo)} samples, reconstruction SNR = ${snr.toFixed(1)} dB`)
console.log(snr > 60 ? '✅ near-perfect reconstruction — separation DSP plumbing is correct' : (snr > 30 ? '✓ good reconstruction' : '❌ reconstruction error'))
