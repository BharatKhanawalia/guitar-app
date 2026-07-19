/**
 * rangeFill — inline style for a range <input> so only the portion LEFT of the
 * thumb is coloured (the rest stays blank). Pairs with the `--pct`-driven track
 * background in index.css. Usage: `style={rangeFill(value, min, max)}`.
 */
export const rangeFill = (v, min, max) => ({
  '--pct': `${Math.max(0, Math.min(100, ((Number(v) - min) / (max - min)) * 100))}%`,
})
