/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      // Add xs (480px) breakpoint between default (0px) and sm (640px).
      // Lets the app use a denser tile grid on small phones.
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
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
