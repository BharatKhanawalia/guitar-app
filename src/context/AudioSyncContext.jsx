import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import PlaybackEngine from '../lib/playbackEngine'
import { decodeSegments } from '../lib/chordDetect'
import { transposeChord, SHARP_KEYS } from '../lib/chordTheory'

/**
 * AudioSyncContext — the single source of truth for playback + UI sync while the
 * result modal is open. Owns ONE PlaybackEngine, runs a rAF loop pushing the
 * current position into state, and derives everything the UI needs: the active
 * chord, and a measure-based BEAT GRID (from tempo + meter + beat-shift).
 *
 * Forcing a key re-decodes the cached chromagram instantly (no re-analysis).
 * Transpose shifts both the audio (detune) and every written chord.
 */

const Ctx = createContext(null)

export function AudioSyncProvider({ result, audioBytes, preferFlats, children }) {
  const engineRef = useRef(null)
  if (!engineRef.current) engineRef.current = new PlaybackEngine()
  const engine = engineRef.current

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [rate, setRateState] = useState(1)
  const [semitones, setSemitones] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [suppress, setSuppress] = useState(false)

  // Analysis / grid settings
  const [meter, setMeter] = useState(4) // 4 = 4/4, 3 = 3/4
  const [beatShift, setBeatShift] = useState(0) // in beats (fractional)
  const [keyForce, setKeyForce] = useState(null) // { tonicPc, mode } | null

  const duration = result?.duration || 0
  const bpm = result?.bpm || 120
  const beatOffset = result?.beatOffset || 0

  // Dev-only handle so automated tests can read real output level (getLevel()).
  if (import.meta.env.DEV) window.__capoEngine = engine

  // --- Load audio once. ---
  useEffect(() => {
    let alive = true
    engine.load(audioBytes.slice(0)).then(() => alive && setReady(true))
    engine.onEnded(() => {
      setPlaying(false)
      setTime(engine.duration)
    })
    return () => {
      alive = false
      engine.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- rAF position pump while playing. ---
  useEffect(() => {
    if (!playing) return
    let raf
    const loop = () => {
      setTime(engine.positionSeconds())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, engine])

  /* ---- transport ---------------------------------------------------- */
  const togglePlay = useCallback(async () => {
    await engine.toggle()
    setPlaying(engine.isPlaying())
  }, [engine])

  const seek = useCallback(
    (t) => {
      engine.seek(t)
      setTime(engine.positionSeconds())
    },
    [engine],
  )

  const setRate = useCallback(
    (r) => {
      engine.setRate(r)
      setRateState(r)
      setTime(engine.positionSeconds())
    },
    [engine],
  )

  const shiftPitch = useCallback(
    (delta) => {
      setSemitones((s) => {
        const next = Math.max(-6, Math.min(6, s + delta))
        engine.setSemitones(next)
        return next
      })
    },
    [engine],
  )

  const setVolume = useCallback(
    (v) => {
      engine.setVolume(v)
      setVolumeState(v)
    },
    [engine],
  )

  const toggleSuppress = useCallback(() => {
    setSuppress((s) => {
      engine.setMelodySuppress(!s)
      return !s
    })
  }, [engine])

  /* ---- base segments (re-decoded when a key is forced) -------------- */
  const baseSegments = useMemo(() => {
    if (keyForce && result?.frames) {
      try {
        return decodeSegments(result.frames, {
          engine: result.engine === 'ai' ? 'accurate' : result.frames.engine || 'accurate',
          preferFlats,
          keyForce,
        })
      } catch {
        return result?.segments || []
      }
    }
    return result?.segments || []
  }, [keyForce, result, preferFlats])

  const segments = useMemo(
    () => baseSegments.map((s) => ({ ...s, chord: transposeChord(s.chord, semitones, preferFlats) })),
    [baseSegments, semitones, preferFlats],
  )

  const activeIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < segments.length; i++) {
      if (time >= segments[i].start - 0.02) idx = i
      else break
    }
    return idx
  }, [segments, time])

  /* ---- measure-based beat grid ------------------------------------- */
  const beats = useMemo(() => {
    if (!segments.length || duration <= 0) return []
    const beatDur = 60 / bpm
    let phase = (beatOffset + beatShift * beatDur) % beatDur
    if (phase < 0) phase += beatDur

    const chordAt = (t) => {
      for (let i = segments.length - 1; i >= 0; i--) {
        if (t >= segments[i].start) return segments[i].chord
      }
      return segments[0].chord
    }

    const out = []
    // Optional pickup cell before beat one so the first strum isn't clipped.
    if (phase > 0.12) out.push({ start: 0, end: phase, chord: chordAt(phase / 2), pickup: true })
    for (let t = phase, k = 0; t < duration - 0.02; t += beatDur, k++) {
      const start = t
      const end = Math.min(t + beatDur, duration)
      out.push({ start, end, chord: chordAt((start + end) / 2) })
    }
    // Flag the first beat of each chord run so the grid only labels changes.
    let prev = null
    for (const b of out) {
      b.changed = b.chord !== prev
      prev = b.chord
    }
    return out
  }, [segments, bpm, beatOffset, beatShift, meter, duration])

  const activeBeat = useMemo(() => {
    for (let i = 0; i < beats.length; i++) {
      if (time >= beats[i].start && time < beats[i].end) return i
    }
    return time >= duration ? beats.length - 1 : -1
  }, [beats, time, duration])

  const beatProgress = useMemo(() => {
    const b = beats[activeBeat]
    if (!b) return 0
    return Math.max(0, Math.min(1, (time - b.start) / Math.max(0.05, b.end - b.start)))
  }, [beats, activeBeat, time])

  /* ---- navigation (by chord change) -------------------------------- */
  const jumpTo = useCallback(
    (index) => {
      const c = Math.max(0, Math.min(index, segments.length - 1))
      if (segments[c]) seek(segments[c].start)
    },
    [segments, seek],
  )
  const next = useCallback(() => jumpTo(activeIndex + 1), [jumpTo, activeIndex])
  const prev = useCallback(() => {
    const cur = segments[activeIndex]
    if (cur && time - cur.start > 1.2) jumpTo(activeIndex)
    else jumpTo(activeIndex - 1)
  }, [jumpTo, activeIndex, segments, time])

  const seekToBeat = useCallback((b) => b && seek(b.start), [seek])

  /* ---- settings actions -------------------------------------------- */
  const nudgeBeat = useCallback((d) => setBeatShift((s) => +(s + d).toFixed(3)), [])
  const resetBeat = useCallback(() => setBeatShift(0), [])

  // Forced key defaults to the detected key the first time it's engaged.
  const detected = result?.key
  const forcedKeyInfo = useMemo(() => {
    if (keyForce) return { ...keyForce, label: SHARP_KEYS[keyForce.tonicPc] + (keyForce.mode === 'minor' ? 'm' : '') }
    return null
  }, [keyForce])

  const engageKey = useCallback(() => {
    setKeyForce((k) => {
      if (k) return k
      // seed from detected key, else C major
      let tonicPc = 0
      let mode = 'major'
      if (detected) {
        tonicPc = SHARP_KEYS.indexOf(detected.tonic) >= 0 ? SHARP_KEYS.indexOf(detected.tonic) : 0
        mode = detected.mode
      }
      return { tonicPc, mode }
    })
  }, [detected])

  const nudgeKey = useCallback(
    (d) => {
      engageKey()
      setKeyForce((k) => (k ? { ...k, tonicPc: ((k.tonicPc + d) % 12 + 12) % 12 } : k))
    },
    [engageKey],
  )
  const toggleKeyMode = useCallback(() => {
    engageKey()
    setKeyForce((k) => (k ? { ...k, mode: k.mode === 'major' ? 'minor' : 'major' } : k))
  }, [engageKey])
  const resetKey = useCallback(() => setKeyForce(null), [])

  const value = {
    ready, playing, time, duration, rate, semitones, volume, suppress, bpm,
    segments, activeIndex,
    meter, setMeter,
    beatShift, nudgeBeat, resetBeat,
    beats, activeBeat, beatProgress, seekToBeat,
    key: result?.key || null,
    forcedKey: forcedKeyInfo,
    nudgeKey, toggleKeyMode, resetKey,
    engine: result?.engine,
    scaledDuration: duration / rate,
    togglePlay, seek, setRate, shiftPitch, setVolume, toggleSuppress,
    next, prev, jumpTo,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAudioSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAudioSync must be used inside <AudioSyncProvider>')
  return ctx
}
