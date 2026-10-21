/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        'bad-ink': 'var(--bad-ink)',
        focus: 'var(--focus)',
      },
      fontSize: {
        // Large by default: the main announcement is read from across a room.
        hero: ['clamp(1.75rem, 4vw, 2.75rem)', { lineHeight: '1.25' }],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
}
