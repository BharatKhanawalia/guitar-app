import { motion } from 'framer-motion'

/**
 * Background — a subtle, animated radial-gradient field of deep blues/purples.
 * Three drifting blobs behind a grain/blur create the "designer" depth.
 */
export default function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-ink-900">
      {/* Base radial wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 120% at 20% 0%, #1b1140 0%, #0c0820 45%, #07050f 100%)',
        }}
      />

      {/* Drifting color blobs */}
      <motion.div
        className="absolute -top-1/4 -left-1/4 h-[70vh] w-[70vh] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.55), transparent 60%)' }}
        animate={{ x: [0, 80, -40, 0], y: [0, -60, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 -right-1/4 h-[60vh] w-[60vh] rounded-full blur-[130px]"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.35), transparent 60%)' }}
        animate={{ x: [0, -70, 30, 0], y: [0, 50, -30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 h-[55vh] w-[55vh] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.28), transparent 60%)' }}
        animate={{ x: [0, 50, -50, 0], y: [0, 30, 60, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Fine noise overlay for texture */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}
