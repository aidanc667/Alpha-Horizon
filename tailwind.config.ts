import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-sans)',    'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia',   'serif'],
        mono:    ['var(--font-mono)',    'monospace'],
        brand:   ['var(--font-display)', 'Georgia',   'serif'],
      },
      colors: {
        // H theme tokens
        cream:    { DEFAULT: '#faf8f3', card: '#ffffff' },
        espresso: { DEFAULT: '#120d08', border: '#1e1610' },
        ink:      { DEFAULT: '#1a1008', muted: '#6b5840', dim: '#b09060' },
        gold:     { DEFAULT: '#C9A84C', light: '#E4C97E', pale: '#fefce8', border: '#fde68a' },
        // Per-app accents
        emerald: {
          DEFAULT: '#16a34a', pale: '#f0fdf4', border: '#bbf7d0',
          50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d',
        },
        indigo:  { DEFAULT: '#6366f1', pale: '#eef2ff', border: '#c7d2fe' },
        violet:  { DEFAULT: '#7c3aed', pale: '#f5f3ff', border: '#ddd6fe' },
        crimson: { DEFAULT: '#b91c1c', pale: '#fff1f2', border: '#fecdd3' },
      },
      animation: {
        'fade-up':    'fadeUp 0.4s ease both',
        'fade-in':    'fadeIn 0.3s ease both',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'ticker':     'tickerScroll 30s linear infinite',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        tickerScroll: {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
