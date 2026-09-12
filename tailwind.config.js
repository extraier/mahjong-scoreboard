/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Pad safe area insets, accessible as Tailwind classes e.g. pb-safe-bottom
      padding: {
        'safe-top': 'max(0px, env(safe-area-inset-top))',
        'safe-bottom': 'max(0px, env(safe-area-inset-bottom))',
        'safe-left': 'max(0px, env(safe-area-inset-left))',
        'safe-right': 'max(0px, env(safe-area-inset-right))',
      },
    },
  },
  plugins: [],
}
