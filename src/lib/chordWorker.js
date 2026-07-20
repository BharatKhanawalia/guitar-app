/**
 * chordWorker.js — runs the (heavy, hand-rolled-FFT) chord analysis OFF the main
 * thread so a 4–5 minute song no longer freezes the UI. analyzePcm has zero browser
 * dependencies by design, so it runs unchanged here. Decoding to PCM still happens
 * on the main thread (OfflineAudioContext isn't available in workers) — only the
 * FFT/chroma/beat/Viterbi crunch is offloaded.
 */
import { analyzePcm } from './chordDetect'

self.onmessage = async (e) => {
  const { data, sampleRate, opts } = e.data
  try {
    const res = await analyzePcm(data, sampleRate, {
      ...opts,
      onProgress: (p) => self.postMessage({ type: 'progress', p }),
    })
    self.postMessage({ type: 'done', res })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) })
  }
}
