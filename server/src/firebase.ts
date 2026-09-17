/**
 * firebase.ts — single source of truth for Firebase Admin initialization.
 *
 * Trap 1 (per skill `firebase-admin-vercel-cjs-interop`):
 *   firebase-admin v13+ no longer exposes auth/firestore/FieldValue from
 *   the top-level package. Always import from sub-modules.
 *
 *   import { initializeApp, cert } from 'firebase-admin/app';
 *   import { getAuth } from 'firebase-admin/auth';
 *   import { getFirestore } from 'firebase-admin/firestore';
 *
 * The trap that burns 8 deploys: tests pass, prod throws at first call.
 *
 * Trap 2: firebase-admin MUST be in `dependencies`, not `devDependencies`
 *   (Vercel production installs only deps). We add it in package.json.
 *
 * Trap 3: jose v6 is ESM-only. We pin jose v5 via `overrides`.
 */

import { initializeApp, getApps, applicationDefault, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

interface FirebaseHandles {
  app: App;
  auth: Auth;
  firestore: Firestore;
}

let _handles: FirebaseHandles | null = null;

export function getFirebase(): FirebaseHandles {
  if (_handles) return _handles;

  const projectId = config.firebase.projectId;
  if (!projectId) {
    throw new Error(
      'FIREBASE_PROJECT_ID is unset. Cannot initialize Firebase Admin. ' +
      'Set it in .env or in your Vercel project env.',
    );
  }

  // Decode the service account JSON if provided. If unset, fall back to
  // Application Default Credentials (works on GCP, Vercel with SA attached,
  // and local `gcloud auth application-default login`).
  let credential: ReturnType<typeof cert> | undefined;
  if (config.firebase.serviceAccountJson) {
    try {
      const decoded = JSON.parse(
        Buffer.from(config.firebase.serviceAccountJson, 'base64').toString('utf-8'),
      );
      credential = cert(decoded);
    } catch (e) {
      throw new Error(
        'Failed to decode FIREBASE_SERVICE_ACCOUNT_JSON: ' +
        (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  // If a Firebase emulator host is set, point the SDK at it. This is
  // detected via the env vars the SDK itself reads, but we make the
  // intention explicit here too.
  // (No additional config needed; the SDK reads FIREBASE_AUTH_EMULATOR_HOST
  // and FIRESTORE_EMULATOR_HOST directly.)

  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      credential: credential ?? applicationDefault(),
    });

  const auth = getAuth(app);
  const firestore = getFirestore(app);

  // Persistent cache handles for warm starts.
  _handles = { app, auth, firestore };
  return _handles;
}

/** Reset cached handles — used by tests to swap emulators. */
export function resetFirebase(): void {
  _handles = null;
}
