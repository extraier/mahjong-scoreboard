import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // REQUIRED for Capacitor file:// WebView asset paths
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
