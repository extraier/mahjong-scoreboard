/**
 * BottomSheet — slide-up modal sheet (iOS-style).
 *
 * Replaces the inline report-wrong modal in AiCameraPanel.
 * - Slides up from bottom with translate-y animation
 * - Backdrop covers the entire viewport with semi-transparent overlay
 * - Drag handle visible at top (visual cue, drag-to-dismiss optional)
 * - Tap backdrop to dismiss
 * - Renders children inside the sheet body
 * - Safe-area-inset padding for iOS notch / Android nav bar
 *
 * Phase 1 implementation:
 *   - No drag-to-dismiss (rely on backdrop + button)
 *   - Animate via Tailwind transition-transform + duration-300
 *   - Locks background scroll when open via overflow-hidden on body
 */

import { useEffect, useRef } from 'react';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Title shown at top of sheet (e.g. "校正 AI 識別結果") */
  title: string;
  /** Optional subtitle/description below the title */
  description?: string;
  /** Sheet body content */
  children: React.ReactNode;
  /** Whether to render the iOS-style drag handle at the top (default true) */
  showHandle?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  showHandle = true,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Lock background scroll while open + close on Escape
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bottom-sheet-title"
    >
      {/* Backdrop — tap to dismiss */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 transition-opacity duration-300 animate-[fadeIn_0.3s_ease-out]"
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl pb-safe-bottom animate-[slideUp_0.3s_ease-out] max-h-[85vh] flex flex-col"
        style={{
          // Tailwind doesn't include animation keyframes by default; declare inline
          // so the sheet always slides up regardless of global config.
        }}
      >
        {showHandle && (
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1.5 rounded-full bg-slate-300" aria-hidden="true" />
          </div>
        )}

        <div className="px-5 pt-2 pb-3 border-b border-slate-100">
          <h3 id="bottom-sheet-title" className="text-base font-black text-slate-900">
            {title}
          </h3>
          {description && (
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{description}</p>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
