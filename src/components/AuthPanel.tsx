/**
 * AuthPanel — sign in / sign up / sign out, shown in the 設定 tab.
 *
 * Design notes:
 *   - Full Cantonese, no English IATA-style jargon. Matches the rest of
 *     the app's copy.
 *   - New page over inline toggle is the user's standing preference for
 *     features, but sign-in is a small utility that belongs where the
 *     subscription state already lives (設定), so it is a card there.
 *   - No localStorage "remember me" — the Firebase SDK persists the session
 *     itself; we do not add a second, conflicting persistence layer.
 */

import { useEffect, useState } from 'react';
import { signIn, signOut, signUp, subscribeToAuth } from '../lib/authClient';
import { isFirebaseConfigured } from '../lib/firebase';
import type { User } from 'firebase/auth';

type Mode = 'signin' | 'signup';

export interface AuthPanelProps {
  /** Called after a successful sign-in so the caller can refresh entitlements */
  onSignedIn?: () => void | Promise<void>;
}

export function AuthPanel({ onSignedIn }: AuthPanelProps) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => subscribeToAuth(setUser), []);

  if (!isFirebaseConfigured()) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">
        登入功能未設定。AI 識別功能暫時用唔到，其他功能照常用。
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const res =
      mode === 'signup'
        ? await signUp(email.trim(), password, displayName.trim() || undefined)
        : await signIn(email.trim(), password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? '操作失敗，請再試一次。');
      return;
    }
    setPassword('');
    await onSignedIn?.();
  }

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
    await onSignedIn?.();
  }

  if (user) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
        <div>
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">已登入</div>
          <div className="font-black text-emerald-950 mt-1 break-all">
            {user.displayName || user.email || '已登入用戶'}
          </div>
          {user.email && user.displayName && (
            <div className="text-xs text-emerald-800/70 break-all">{user.email}</div>
          )}
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          className="w-full py-2.5 rounded-xl border-2 border-emerald-600 text-emerald-800 font-black text-sm active:scale-95 transition-transform disabled:opacity-60"
        >
          {busy ? '登出中…' : '登出'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 space-y-4">
      <div>
        <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">
          帳戶
        </div>
        <div className="text-xs text-emerald-800/70 mt-1">
          登入之後先用得到 AI 識別同會員功能。
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-black border-2 transition-all ${
            mode === 'signin'
              ? 'border-emerald-600 bg-white text-emerald-800 shadow'
              : 'border-transparent text-emerald-600/50'
          }`}
        >
          登入
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-black border-2 transition-all ${
            mode === 'signup'
              ? 'border-emerald-600 bg-white text-emerald-800 shadow'
              : 'border-transparent text-emerald-600/50'
          }`}
        >
          註冊
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'signup' && (
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="顯示名稱（可留空）"
            autoComplete="nickname"
            className="w-full p-3 rounded-xl bg-white border border-emerald-200 outline-none focus:border-emerald-500 text-sm"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="電郵"
          required
          autoComplete="email"
          inputMode="email"
          className="w-full p-3 rounded-xl bg-white border border-emerald-200 outline-none focus:border-emerald-500 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密碼（最少 6 個字元）"
          required
          minLength={6}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className="w-full p-3 rounded-xl bg-white border border-emerald-200 outline-none focus:border-emerald-500 text-sm"
        />

        {error && (
          <div className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
        {notice && (
          <div className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-xl px-3 py-2">
            {notice}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-black text-sm shadow active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? '處理中…' : mode === 'signup' ? '建立帳戶' : '登入'}
        </button>
      </form>
    </div>
  );
}
