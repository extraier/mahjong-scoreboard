/**
 * authClient — thin wrapper over Firebase Auth.
 *
 * The rest of the app never touches the Firebase SDK directly. This module
 * exposes:
 *   - signUp / signIn / signOut
 *   - subscribeToAuth(cb) — fires immediately with the current user, then
 *     on every change (so a sign-out elsewhere in the app is reflected)
 *   - getAuthToken() — returns a fresh ID token, or null when signed out.
 *
 * `getAuthToken()` is wired into `configureApiClient({ getAuthToken })` in
 * main.tsx. The apiClient calls it per request, so a refreshed token is
 * picked up automatically without any re-render plumbing.
 */

import {
  createUserWithEmailAndPassword,
  getIdToken,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from './firebase';

export interface AuthResult {
  ok: boolean;
  user?: User;
  /** Cantonese message for the UI when ok === false */
  error?: string;
}

function mapAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return '電郵格式唔啱。';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '電郵或者密碼唔啱。';
    case 'auth/email-already-in-use':
      return '呢個電郵已經註冊咗，直接登入就得。';
    case 'auth/weak-password':
      return '密碼太短，請用至少 6 個字元。';
    case 'auth/too-many-requests':
      return '試得太密，請等一陣再試。';
    case 'auth/network-request-failed':
      return '網絡連線失敗，請檢查網絡狀態。';
    default:
      return e instanceof Error ? e.message : '登入失敗，請再試一次。';
  }
}

/** Register a new account with email + password. */
export async function signUp(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: '登入功能未設定，請聯絡我們。' };
  }
  try {
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    return { ok: true, user: cred.user };
  } catch (e) {
    return { ok: false, error: mapAuthError(e) };
  }
}

/** Sign in with email + password. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: '登入功能未設定，請聯絡我們。' };
  }
  try {
    const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    return { ok: true, user: cred.user };
  } catch (e) {
    return { ok: false, error: mapAuthError(e) };
  }
}

/** Sign out. */
export async function signOut(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await fbSignOut(getFirebaseAuth());
}

/**
 * Subscribe to auth state changes.
 *
 * Fires immediately with the current user (or null), then on every change.
 * Returns an unsubscribe function.
 */
export function subscribeToAuth(cb: (user: User | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(getFirebaseAuth(), (user) => cb(user));
}

/**
 * Current ID token, or null when signed out.
 *
 * Called by the apiClient on every request. `getIdToken` is cheap when the
 * cached token is still fresh (it auto-refreshes in the background when
 * close to expiry), so there is no need to cache it here.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return null;
    return await getIdToken(user);
  } catch {
    return null;
  }
}
