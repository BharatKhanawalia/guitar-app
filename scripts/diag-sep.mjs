import ort from 'onnxruntime-node'
import { mdxStft, mdxIstft, MDX } from '../src/lib/mdx.js'
import { analyzePcm } from '../src/lib/chordDetect.js'
import { respellChord, parseChord } from '../src/lib/chordTheory.js'
import { spawnSync } from 'node:child_process'

const SR = 44100
const { DIM_F, DIM_T } = MDX
const canon = (s) => (parseChord(s) ? respellChord(s, false) : s)
const TRUTH = new Set(['F#m', 'C#m', 'A', 'B', 'E', 'G#m', 'Gm', 'Dm', 'Bb', 'C', 'F', 'D'].map(canon))

const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'public/beatles.mp3', '-t', '45', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4))

const session = await ort.InferenceSession.create('models/UVR-MDX-NET-Inst_HQ_3.onnx')
const spec = mdxStft(x)
const frames = spec.frames
const outRe = spec.re.map(() => new Float32Array(DIM_F))
const outIm = spec.im.map(() => new Float32Array(DIM_F))
const nChunks = Math.ceil(frames / DIM_T)
const buf = new Float32Array(4 * DIM_F * DIM_T)
for (let c = 0; c < nChunks; c++) {
  const f0 = c * DIM_T; buf.fill(0)
  for (let t = 0; t < DIM_T; t++) { const f = f0 + t; if (f >= frames) break
    const rr = spec.re[f], ii = spec.im[f]
    for (let k = 0; k < DIM_F; k++) { const b = k * DIM_T + t
      buf[b] = rr[k]; buf[DIM_F*DIM_T + b] = ii[k]; buf[2*DIM_F*DIM_T + b] = rr[k]; buf[3*DIM_F*DIM_T + b] = ii[k] } }
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', buf.slice(), [1,4,DIM_F,DIM_T]) })
  const o = res[session.outputNames[0]].data
  for (let t = 0; t < DIM_T; t++) { const f = f0 + t; if (f >= frames) break
    for (let k = 0; k < DIM_F; k++) { const b = k * DIM_T + t
      outRe[f][k] = 0.5*(o[b] + o[2*DIM_F*DIM_T + b]); outIm[f][k] = 0.5*(o[DIM_F*DIM_T + b] + o[3*DIM_F*DIM_T + b]) } }
}
// A: model output as-is ; B: residual (mix - output)
const resRe = spec.re.map((row,f)=>row.map((v,k)=>v-outRe[f][k]))
const resIm = spec.im.map((row,f)=>row.map((v,k)=>v-outIm[f][k]))
const A = mdxIstft({ re: outRe, im: outIm, length: spec.length })
const B = mdxIstft({ re: resRe, im: resIm, length: spec.length })
const rms = (a)=>{let s=0;for(const v of a)s+=v*v;return Math.sqrt(s/a.length)}
async function cov(d){ const res=await analyzePcm(d,SR,{engine:'accurate'}); let tot=0,c=0,h=new Map();
  for(const s of res.segments){const dd=s.end-s.start;tot+=dd;const k=canon(s.chord);h.set(k,(h.get(k)||0)+dd);if(TRUTH.has(k))c+=dd}
  const top=[...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,t])=>`${TRUTH.has(k)?'✓':'✗'}${k}${t.toFixed(0)}`).join(' ')
  return {cov:tot?100*c/tot:0,key:res.key?.label,top} }
console.log('RMS  orig', rms(x).toFixed(4), '| output', rms(A).toFixed(4), '| residual', rms(B).toFixed(4))
const co = await cov(x), ca = await cov(A), cb = await cov(B)
console.log('orig     :', co.cov.toFixed(1)+'%', co.key, co.top)
console.log('output   :', ca.cov.toFixed(1)+'%', ca.key, ca.top)
console.log('residual :', cb.cov.toFixed(1)+'%', cb.key, cb.top)
