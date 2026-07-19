/**
 * sepWorker.js — runs the ENTIRE MDX vocal separation off the main thread.
 *
 * STFT + 66 MB ONNX inference + ISTFT are heavy and single-threaded, so doing
 * them on the UI thread freezes the page (Chrome's "page unresponsive" dialog).
 * Here it all runs in a Web Worker; only progress + the finished instrumental
 * cross back to the main thread, so the UI stays smooth and the bar keeps moving.
 *
 * The ORT session is cached for the worker's lifetime → the 66 MB model downloads
 * once, then subsequent songs skip straight to separating.
 */
import * as ort from 'onnxruntime-web'
import { mdxSeparate } from './mdx.js'

const MODEL_URL =
  'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx'

// ORT fetches its own runtime WASM from the version-matched CDN.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
ort.env.wasm.numThreads = 1

// WebGPU is 10–50× faster than single-threaded WASM and needs no COOP/COEP
// headers — essential to separate a full-length song in reasonable time. Falls
// back to CPU-WASM automatically if the browser has no WebGPU.
const EXECUTION_PROVIDERS = ['webgpu', 'wasm']

let session = null

async function getSession(onProgress) {
  if (session) return session
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`model fetch failed (${res.status})`)
  const total = +res.headers.get('content-length') || 0
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    if (total) onProgress(got / total)
  }
  const bytes = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.length
  }
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: EXECUTION_PROVIDERS })
  } catch {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  }
  return session
}

self.onmessage = async (e) => {
  const { audio } = e.data
  try {
    const s = await getSession((p) => self.postMessage({ type: 'progress', phase: 'model', p }))
    const instrumental = await mdxSeparate(audio, s, ort, (p) =>
      self.postMessage({ type: 'progress', phase: 'separate', p }),
    )
    self.postMessage({ type: 'done', instrumental }, [instrumental.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) })
  }
}
