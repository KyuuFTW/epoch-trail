/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        epoch: {
          bg: '#0A0C10',
          panel: 'rgba(15, 18, 25, 0.85)',
          border: 'rgba(255, 255, 255, 0.08)',
          accent: '#FF3B30',
          yellow: '#FFCC00',
          cyan: '#00E5FF',
          green: '#00E676',
          text: '#F3F4F6',
          muted: '#9CA3AF',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
