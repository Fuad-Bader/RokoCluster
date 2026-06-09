/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Resource palette — kept in sync with src/lib/palette.ts.
        ns: '#8b5cf6',
        node: '#0ea5e9',
        deploy: '#22c55e',
        pod: '#f59e0b',
        container: '#eab308',
        service: '#ec4899',
        panel: '#0f1419',
        panelAlt: '#161b22',
      },
    },
  },
  plugins: [],
};
