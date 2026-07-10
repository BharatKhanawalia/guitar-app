import { motion } from 'framer-motion'
import { getChordShape } from '../lib/chordShapes'

/**
 * FretboardDiagram — a crisp SVG chord voicing diagram.
 * Draws 6 strings × N frets, open/muted markers, finger dots and barre lines.
 */
export default function FretboardDiagram({ symbol, size = 'md', accent = '#a78bfa' }) {
  const shape = getChordShape(symbol)

  const dims = {
    sm: { w: 88, stringGap: 13, fretGap: 16, top: 16, dot: 5 },
    md: { w: 116, stringGap: 17, fretGap: 21, top: 20, dot: 6.5 },
    lg: { w: 150, stringGap: 22, fretGap: 27, top: 26, dot: 8 },
  }[size]

  const FRETS = 5
  const left = 16
  const boardW = dims.stringGap * 5
  const boardH = dims.fretGap * FRETS
  const width = boardW + left * 2
  const height = boardH + dims.top + 20

  if (!shape) {
    return (
      <div
        className="flex items-center justify-center text-white/30 text-xs"
        style={{ width, height }}
      >
        no shape
      </div>
    )
  }

  const baseFret = shape.base && shape.base > 1 ? shape.base : 1
  const isHigh = baseFret > 1

  const stringX = (i) => left + i * dims.stringGap
  const fretY = (f) => dims.top + f * dims.fretGap

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Nut (thick) when in open position */}
      {!isHigh && (
        <rect x={left - 1} y={dims.top - 3} width={boardW + 2} height={3.5} rx={1.5} fill={accent} />
      )}

      {/* Frets */}
      {Array.from({ length: FRETS + 1 }).map((_, f) => (
        <line
          key={`f${f}`}
          x1={left}
          y1={fretY(f)}
          x2={left + boardW}
          y2={fretY(f)}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={1}
        />
      ))}

      {/* Strings */}
      {Array.from({ length: 6 }).map((_, s) => (
        <line
          key={`s${s}`}
          x1={stringX(s)}
          y1={dims.top}
          x2={stringX(s)}
          y2={dims.top + boardH}
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={s === 0 ? 1.6 : 1}
        />
      ))}

      {/* Position label for high-neck shapes */}
      {isHigh && (
        <text
          x={left - 6}
          y={fretY(0) + dims.fretGap * 0.7}
          fontSize={dims.dot * 1.5}
          fill="rgba(255,255,255,0.55)"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
        >
          {baseFret}fr
        </text>
      )}

      {/* Barre line */}
      {shape.barre && (
        <motion.rect
          initial={{ opacity: 0, scaleX: 0.4 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 22 }}
          x={stringX(shape.barre.from) - dims.dot}
          y={fretY(shape.barre.fret - baseFret + 0.5) - dims.dot}
          width={(shape.barre.to - shape.barre.from) * dims.stringGap + dims.dot * 2}
          height={dims.dot * 2}
          rx={dims.dot}
          fill={accent}
          opacity={0.9}
        />
      )}

      {/* Finger dots / open / muted */}
      {shape.frets.map((fret, i) => {
        const x = stringX(i)
        if (fret === -1) {
          return (
            <text
              key={`x${i}`}
              x={x}
              y={dims.top - 6}
              fontSize={dims.dot * 1.7}
              fill="rgba(255,255,255,0.4)"
              textAnchor="middle"
            >
              ×
            </text>
          )
        }
        if (fret === 0) {
          return (
            <circle
              key={`o${i}`}
              cx={x}
              cy={dims.top - 8}
              r={dims.dot * 0.7}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1.4}
            />
          )
        }
        const rel = fret - baseFret
        // Skip dots covered by the barre at that same fret.
        if (shape.barre && fret === shape.barre.fret && i >= shape.barre.from && i <= shape.barre.to) {
          return null
        }
        return (
          <motion.circle
            key={`d${i}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 20, delay: i * 0.02 }}
            cx={x}
            cy={fretY(rel + 0.5)}
            r={dims.dot}
            fill={accent}
          />
        )
      })}
    </svg>
  )
}
