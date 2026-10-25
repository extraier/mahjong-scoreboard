/**
 * firebase.ts — Firebase Web SDK bootstrap.
 *
 * The app is a Capacitor build, so there is no server to mint a session
 * cookie. We use the Firebase Web SDK on the client and hand the ID token
 * to the API client, which sends it as `Authorization: Bearer <token>`.
 * The server verifies it with `firebase-admin/auth.verifyIdToken`.
 *
 * Config comes from Vite env vars (VITE_FIREBASE_*). These are NOT secrets
 * — a Firebase web apiKey is public by design (it is embedded in every
 * client that talks to Firebase). The trust boundary is the Firestore
 * Security Rules + the server-side verification of the ID token, not the
 * apiKey.
 *
 * If the env vars are missing (e.g. a fresh clone without .env.local), we
 * throw a clear error at call time rather than at import time, so the app
 * still boots and the rest of the UI (dice, calculator, scoring) keeps
 * working. Auth features simply report "not configured".
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

/** True when the Vite env vars needed for auth are present. */
export function isFirebaseConfigured(): boolean {
  const env = import.meta.env;
  return Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);
}

function readConfig(): FirebasePublicConfig {
  const env = import.meta.env;
  const cfg: FirebasePublicConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? undefined,
  };
  if (!cfg.apiKey || !cfg.projectId) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_API_KEY, ' +
      'VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_AUTH_DOMAIN and ' +
      'VITE_FIREBASE_APP_ID in .env.local (see .env.example).',
    );
  }
  return cfg;
}

let _app: FirebaseApp | null = null;

/** Get (or lazily create) the Firebase app instance. */
export function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length > 0 ? getApp() : initializeApp(readConfig());
  return _app;
}

let _auth: Auth | null = null;

/** Get (or lazily create) the Firebase Auth instance. */
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseApp());
  return _auth;
}
