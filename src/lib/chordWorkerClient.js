import { analyzePcm } from './chordDetect'

/**
 * analyzeInWorker — run chord analysis in a Web Worker (keeps the UI thread free),
 * falling back to main-thread analysis if a worker can't be created. Give it decoded
 * mono PCM (decode on the main thread first, e.g. via separation.decodeMono).
 *
 * @param {Float32Array} data
 * @param {number} sampleRate
 * @param {object} opts  { engine, preferFlats }
 * @param {(p:number)=>void} [onProgress]
 * @returns {Promise<object>} the analyzePcm result
 */
export async function analyzeInWorker(data, sampleRate, opts = {}, onProgress) {
  try {
    return await new Promise((resolve, reject) => {
      const w = new Worker(new URL('./chordWorker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') onProgress?.(m.p)
        else if (m.type === 'done') { resolve(m.res); w.terminate() }
        else if (m.type === 'error') { reject(new Error(m.message)); w.terminate() }
      }
      w.onerror = (err) => { reject(new Error(err.message || 'chord worker failed')); w.terminate() }
      const copy = data.slice()
      w.postMessage({ data: copy, sampleRate, opts }, [copy.buffer])
    })
  } catch (e) {
    console.warn('Chord worker unavailable — analysing on the main thread:', e)
    return analyzePcm(data, sampleRate, { ...opts, onProgress })
  }
}
