/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          900: '#0a0713',
          800: '#120c22',
          700: '#1a1230',
        },
        accent: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        mint: {
          400: '#34d399',
          500: '#10b981',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glow: '0 0 40px -6px rgba(139, 92, 246, 0.55)',
        'glow-mint': '0 0 44px -4px rgba(16, 185, 129, 0.5)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(6%, -8%) scale(1.1)' },
          '66%': { transform: 'translate(-6%, 6%) scale(0.95)' },
        },
      },
      animation: {
        drift: 'drift 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
