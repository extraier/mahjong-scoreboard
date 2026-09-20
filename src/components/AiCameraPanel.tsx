/**
 * AiCameraPanel — image picker + preview + upload via visionClient +
 * result review.
 *
 * Phase 1 wiring notes:
 *   - Components handles its own state (preview, analyzing, error)
 *   - Emits `onResultConfirmed(tiles, flowers)` to the parent — parent
 *     applies them to its own scoring engine
 *   - 403 (AI_PREMIUM_REQUIRED) is rendered as a PremiumGate-like
 *     inline message so the surface flow is obvious in dev
 *   - All file I/O via plain <input type=file> + URL.createObjectURL
 *     (no Capacitor camera plugin yet — Phase 1 is web-only)
 *
 * Spec ref: §9 (Premium user拍照 flow)
 */

import { useEffect, useRef, useState } from 'react';
import { analyzeMahjongImage, correctMahjongVision } from '../lib/visionClient';
import type {
  ApiError,
  GameMode,
  MahjongVisionResult,
  RoundWind,
  SeatWind,
  UncertainTile,
} from '../types/api';

export interface AiCameraPanelProps {
  gameMode: GameMode;
  roundWind: RoundWind;
  seatWind: SeatWind;
  /** Called when user confirms the AI result; parent writes to scoring engine */
  onResultConfirmed: (tiles: string[], flowers: string[]) => void;
  /** Optional override of the wire endpoint */
  onError?: (e: ApiError) => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'preview'; file: File; previewUrl: string }
  | { kind: 'analyzing'; file: File; previewUrl: string }
  | { kind: 'error'; file: File; previewUrl: string; error: ApiError }
  | { kind: 'result'; file: File; previewUrl: string; result: MahjongVisionResult; requestId: string };

export function AiCameraPanel({
  gameMode,
  roundWind,
  seatWind,
  onResultConfirmed,
  onError,
}: AiCameraPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Revoke the object URL whenever we leave preview/analyzing/result/err
    if ('previewUrl' in phase) {
      const url = phase.previewUrl;
      return () => URL.revokeObjectURL(url);
    }
  }, [phase]);

  const handlePickFile = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPhase({ kind: 'preview', file, previewUrl });
  };

  const analyze = async () => {
    if (phase.kind !== 'preview') return;
    setPhase({ ...phase, kind: 'analyzing' });
    try {
      const response = await analyzeMahjongImage({
        image: phase.file,
        gameMode,
        roundWind,
        seatWind,
      });
      setPhase({ ...phase, kind: 'result', result: response.result, requestId: response.requestId });
    } catch (e) {
      const err = e as ApiError;
      setPhase({ ...phase, kind: 'error', error: err });
      onError?.(err);
    }
  };

  const reset = () => setPhase({ kind: 'idle' });

  if (phase.kind === 'idle') {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full py-4 bg-emerald-100 text-emerald-900 rounded-2xl font-black border-2 border-dashed border-emerald-400 hover:bg-emerald-200 transition-colors"
        >
          📷 選擇相片 / 拍照
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handlePickFile(f);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
      <img
        src={phase.previewUrl}
        alt="手牌預覽"
        className="w-full max-h-64 object-contain rounded-xl bg-slate-100"
      />

      {phase.kind === 'preview' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={analyze}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-black text-sm"
          >
            開始識別
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-bold text-sm"
          >
            重選
          </button>
        </div>
      )}

      {phase.kind === 'analyzing' && (
        <div className="text-center py-2">
          <div className="inline-block w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm font-bold text-slate-700">AI 識別中…</span>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm space-y-2">
          <p className="text-red-900 font-black">⚠️ {phase.error.message}</p>
          {phase.error.code === 'AI_PREMIUM_REQUIRED' && (
            <p className="text-red-700 text-xs">
              你嘅帳戶係免費會員。升級至 PRO 解鎖 AI 識別功能。
            </p>
          )}
          {phase.error.code === 'IMAGE_UNCLEAR' && (
            <div className="space-y-1.5">
              <p className="text-red-800 text-xs font-bold">
                📸 相片質素不符合要求
              </p>
              {phase.error.meta?.retry_hint && (
                <p className="text-red-700 text-xs leading-relaxed">
                  {String(phase.error.meta.retry_hint)}
                </p>
              )}
              {phase.error.meta?.error_code && (
                <p className="text-red-500 text-[10px] font-mono">
                  原因: {String(phase.error.meta.error_code)}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="w-full py-2 bg-white border border-red-200 rounded-lg text-red-700 text-xs font-bold"
          >
            重新選擇相片
          </button>
        </div>
      )}

      {phase.kind === 'result' && (
        <VisionResultReview
          result={phase.result}
          requestId={phase.requestId}
          onConfirm={(tiles, flowers) => {
            onResultConfirmed(tiles, flowers);
            reset();
          }}
          onRetake={reset}
        />
      )}
    </div>
  );
}

function VisionResultReview({
  result,
  requestId,
  onConfirm,
  onRetake,
}: {
  result: MahjongVisionResult;
  requestId: string;
  onConfirm: (tiles: string[], flowers: string[]) => void;
  onRetake: () => void;
}) {
  const [tiles, setTiles] = useState<string[]>(result.tiles);
  const [flowers, setFlowers] = useState<string[]>(result.flowers);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  // 'reportWrong' inline modal state. Empty = closed.
  const [showReport, setShowReport] = useState(false);
  const [reportState, setReportState] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; diff_count: number } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Confidence-based UI cue: < 0.7 → warn the user before confirming
  const lowConfidence = result.confidence < 0.7;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black text-slate-800">
          🪄 AI 識別結果
          <span className="text-xs text-slate-500 ml-2">
            信心度 {(result.confidence * 100).toFixed(0)}%
          </span>
        </h4>
      </div>

      {lowConfidence && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          ⚠ 信心度較低 — 請逐隻牌確認。
        </p>
      )}

      {result.notes.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-0.5">
          {result.notes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      )}

      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">手牌</p>
        <div className="flex flex-wrap gap-1">
          {tiles.map((t, i) => (
            <UncertainTileChip
              key={`${i}-${t}`}
              tile={t}
              uncertain={result.uncertainTiles.find((u: UncertainTile) => u.index === i)}
              isEditing={editingIdx === i}
              onEditClick={() => setEditingIdx(i)}
              onEditChange={(v) => {
                const next = [...tiles];
                next[i] = v.toUpperCase();
                setTiles(next);
                setEditingIdx(null);
              }}
            />
          ))}
        </div>
      </div>

      {flowers.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">花牌</p>
          <div className="flex flex-wrap gap-1">
            {flowers.map((t, i) => (
              <span key={i} className="px-2 py-1 rounded bg-pink-100 text-pink-900 text-xs font-bold border border-pink-200">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onConfirm(tiles, flowers)}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-xl font-black text-sm"
          >
            ✅ 確認套用
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="px-3 py-2 bg-slate-200 text-slate-700 rounded-xl font-bold text-sm"
          >
            重拍
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowReport(true);
            setReportState({ kind: 'idle' });
          }}
          className="w-full py-2 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl font-bold text-xs"
        >
          ⚠️ 識別有誤？我要校正 AI 結果
        </button>
      </div>

      {showReport && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 space-y-2 text-xs">
          <p className="font-black text-amber-900">
            📝 校正 AI 識別結果
          </p>
          <p className="text-amber-800">
            請確認或修改下方嘅牌。改好之後按「送出校正」，錯誤識別會用嚟訓練下一個 AI 模型。多謝你！
          </p>
          <div className="flex flex-wrap gap-1">
            {tiles.map((t, i) => (
              <UncertainTileChip
                key={`report-${i}-${t}`}
                tile={t}
                isEditing={editingIdx === i}
                onEditClick={() => setEditingIdx(i)}
                onEditChange={(v) => {
                  const next = [...tiles];
                  next[i] = v.toUpperCase();
                  setTiles(next);
                  setEditingIdx(null);
                }}
              />
            ))}
          </div>

          {reportState.kind === 'sent' && (
            <div className="bg-emerald-100 border border-emerald-300 rounded-lg p-2 text-emerald-900">
              ✅ {reportState.diff_count > 0
                ? `已記錄 ${reportState.diff_count} 個錯誤識別。多謝你幫助 AI 學習！`
                : '你確認 AI 識別完全正確。感謝你嘅確認！'}
            </div>
          )}
          {reportState.kind === 'error' && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-2 text-red-900">
              ⚠️ {reportState.message}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={reportState.kind === 'sending'}
              onClick={async () => {
                setReportState({ kind: 'sending' });
                try {
                  const resp = await correctMahjongVision({
                    request_id: requestId,
                    corrected_tiles: tiles,
                    photo_consent: false,
                  });
                  setReportState({ kind: 'sent', diff_count: resp.diff_count });
                } catch (e) {
                  const err = e as ApiError;
                  const msg =
                    err.code === 'AI_PREMIUM_REQUIRED'
                      ? '校正功能需要 PRO 會員。'
                      : err.message || '送出失敗，請稍後再試。';
                  setReportState({ kind: 'error', message: msg });
                }
              }}
              className="flex-1 py-2 bg-amber-600 text-white rounded-xl font-black text-xs disabled:bg-amber-300"
            >
              {reportState.kind === 'sending' ? '送出中…' : '📤 送出校正'}
            </button>
            <button
              type="button"
              onClick={() => setShowReport(false)}
              className="px-3 py-2 bg-white border border-amber-300 text-amber-900 rounded-xl font-bold text-xs"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UncertainTileChip({
  tile, uncertain, isEditing, onEditClick, onEditChange,
}: {
  tile: string;
  uncertain?: UncertainTile;
  isEditing: boolean;
  onEditClick: () => void;
  onEditChange: (v: string) => void;
}) {
  if (isEditing) {
    return (
      <input
        autoFocus
        type="text"
        defaultValue={tile}
        maxLength={2}
        onBlur={(e) => onEditChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEditChange((e.target as HTMLInputElement).value); }}
        className="w-12 px-1 py-1 text-center text-xs font-black rounded bg-white border-2 border-emerald-500 outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onEditClick}
      title={uncertain ? `不確定: ${uncertain.reason}` : '點擊修改'}
      className={`relative px-2 py-1 rounded text-xs font-bold border ${
        uncertain
          ? 'bg-amber-100 border-amber-300 text-amber-900'
          : 'bg-white border-slate-200 text-slate-800'
      }`}
    >
      {tile}
      {uncertain && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500" />}
    </button>
  );
}
