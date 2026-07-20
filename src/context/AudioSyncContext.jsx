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
  const [loadError, setLoadError] = useState(null)
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
    engine
      .load(audioBytes.slice(0))
      .then(() => alive && setReady(true))
      .catch((err) => {
        // Corrupt bytes / unsupported codec / empty buffer — surface it instead of
        // spinning "Preparing playback…" forever.
        console.error('Audio decode failed:', err)
        if (alive) setLoadError(err?.message || 'This audio could not be decoded for playback.')
      })
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

  // Hard stop — silences the audio immediately (used when the modal closes, so the
  // song never keeps playing behind a dismissed dialog).
  const stop = useCallback(() => {
    engine.pause()
    setPlaying(false)
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

  /* ---- STRICT uniform beat grid (constant BPM) ---------------------- */
  // The cursor must move at a CONSTANT tempo, and every row is exactly `meter`
  // cells — no pickups, no empty padding. Cells tile the whole song at 60/bpm from
  // a fixed phase; rows are strict groups of `meter` beats aligned so bar lines
  // start on the "one" (the beat where chords change most). Because the BPM is now
  // correct (e.g. khudajane's 3 s bar → 81 BPM), the grid no longer drifts.
  const beatGrid = useMemo(() => {
    if (!segments.length || duration <= 0 || !bpm) return { cells: [], rows: [] }
    const beatPeriod = 60 / bpm
    if (beatPeriod < 0.12) return { cells: [], rows: [] }

    const chordAt = (t) => {
      for (let i = segments.length - 1; i >= 0; i--) if (t >= segments[i].start) return segments[i].chord
      return segments[0].chord
    }

    // Uniform cells from the beat phase, tiling [0, duration].
    const phase = ((beatOffset % beatPeriod) + beatPeriod) % beatPeriod
    const cells = []
    for (let t = phase > 0.04 ? phase - beatPeriod : phase, idx = 0; t < duration - 0.04; t += beatPeriod, idx++) {
      const start = Math.max(0, t)
      const end = Math.min(duration, t + beatPeriod)
      if (end - start < 0.05) continue
      cells.push({ start, end, chord: chordAt((start + end) / 2), index: cells.length })
    }
    if (!cells.length) return { cells: [], rows: [] }

    // Downbeat phase p (0..meter-1): pick the offset that lands the most chord
    // CHANGES on the "one" (chords overwhelmingly change on the downbeat), each
    // vote weighted by the duration of the chord it starts. Beat-Shift nudges it.
    const nearestIdx = (t) => {
      let b = 0
      let bd = Infinity
      for (let i = 0; i < cells.length; i++) {
        const d = Math.abs(cells[i].start - t)
        if (d < bd) { bd = d; b = i }
      }
      return b
    }
    const phaseScore = new Array(meter).fill(0)
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]
      if (s.start > 0.1 && (i === 0 || segments[i - 1].chord !== s.chord)) {
        phaseScore[((nearestIdx(s.start) % meter) + meter) % meter] += Math.max(0.2, s.end - s.start)
      }
    }
    let p = 0
    for (let i = 1; i < meter; i++) if (phaseScore[i] > phaseScore[p]) p = i
    p = (((p + Math.round(beatShift)) % meter) + meter) % meter

    let prevChord = null
    for (const c of cells) {
      c.downbeat = (((c.index - p) % meter) + meter) % meter === 0
      c.changed = c.chord !== prevChord
      c.showLabel = c.changed || c.downbeat
      prevChord = c.chord
    }

    // Rows: start at the first downbeat, then STRICT groups of `meter` cells. No
    // empty placeholder cells — a short final row simply has fewer cells.
    const firstDown = Math.max(0, cells.findIndex((c) => c.downbeat))
    const rows = []
    for (let i = firstDown; i < cells.length; i += meter) rows.push(cells.slice(i, i + meter))
    return { cells, rows }
  }, [segments, duration, bpm, meter, beatShift, beatOffset])

  const beats = beatGrid.cells
  const rows = beatGrid.rows
  const lyrics = result?.lyrics || null

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
  // Beat-shift now moves the DOWNBEAT phase by whole beats (which beat is "one").
  const nudgeBeat = useCallback((d) => setBeatShift((s) => Math.round(s + d)), [])
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
    ready, loadError, playing, time, duration, rate, semitones, volume, suppress, bpm,
    segments, activeIndex,
    meter, setMeter,
    beatShift, nudgeBeat, resetBeat,
    beats, rows, activeBeat, beatProgress, seekToBeat,
    lyrics, lyricsStatus: result?.lyricsStatus || null,
    key: result?.key || null,
    forcedKey: forcedKeyInfo,
    nudgeKey, toggleKeyMode, resetKey,
    engine: result?.engine,
    engineLabel: result?.engineLabel || 'Traditional (DSP)',
    scaledDuration: duration / rate,
    togglePlay, stop, seek, setRate, shiftPitch, setVolume, toggleSuppress,
    next, prev, jumpTo,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAudioSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAudioSync must be used inside <AudioSyncProvider>')
  return ctx
}
