import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// ------------------------------------------------------------
// iOS Safari status bar polyfill
// ------------------------------------------------------------
// On iOS Safari opened as a REGULAR TAB (not a PWA), the
// `env(safe-area-inset-top)` reports 0 — Apple only honors it
// when the page is launched from the home screen. But the iOS
// status bar (time, signal, battery) still draws on top of the
// page content at y=0, making it unreadable against our dark
// green app header.
//
// Detection: iOS + (not standalone PWA) + env() reports 0 →
// reserve ~44px above the green header by setting --status-bar-h.
// Standard iPhone (11/12/13/14) = 44px; iPhone with Dynamic Island
// (14 Pro/15/16) = 47-59px. We use 47px as a safe middle value.
//
// Set the variable BEFORE React mounts so there's no layout flash.
// ------------------------------------------------------------
(() => {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
  const isStandalonePWA = ('standalone' in navigator && (navigator as any).standalone) === true
    || window.matchMedia('(display-mode: standalone)').matches
  if (isIOS && !isStandalonePWA) {
    // Use 47px which is safe for both standard notch (44) and Dynamic Island (~47)
    document.documentElement.style.setProperty('--status-bar-h', '47px')
  }
})()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
