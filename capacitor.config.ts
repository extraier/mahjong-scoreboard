import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.comparetiger.mahjongscoreboard',
  appName: '麻雀神器 PRO',
  webDir: 'dist',
  server: {
    androidScheme: 'https', // Required for Capacitor 6 — see capacitor-wrap-web-app skill
  },
  android: {
    // Adaptive icon background color (emerald-950 from app header)
    backgroundColor: '#064e3b',
    allowMixedContent: false, // AdSense on https; mixed content would break ads
  },
}

export default config
