import React, { useEffect, useState, useRef } from 'react';
import { X, Crosshair, CheckCircle2 } from 'lucide-react';
import { SessionClip } from '../types';
import appLogo from '../assets/icon.png';

export interface SnackbarNotification {
  id: string;
  title: string;
  message: string;
  clip?: SessionClip;
  durationMs?: number;
}

interface NotificationSnackbarProps {
  notification: SnackbarNotification | null;
  onClose: () => void;
  onReviewClip?: (clip: SessionClip) => void;
}

export const NotificationSnackbar: React.FC<NotificationSnackbarProps> = React.memo(({
  notification,
  onClose,
  onReviewClip,
}) => {
  const [progress, setProgress] = useState(100);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const notifId = notification?.id;
  const durationMs = notification?.durationMs || 3500;

  useEffect(() => {
    if (!notifId) return;

    setProgress(100);
    const startTime = performance.now();

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remaining);

      if (elapsed >= durationMs) {
        clearInterval(interval);
        onCloseRef.current();
      }
    }, 40);

    return () => {
      clearInterval(interval);
    };
  }, [notifId, durationMs]);

  if (!notification) return null;

  return (
    <aside
      aria-label="Notifications"
      className="fixed top-12 right-4 z-50 max-w-sm w-full bg-[#0c121e]/98 backdrop-blur-2xl border border-cyan-500/50 rounded-2xl shadow-2xl overflow-hidden animate-slideInRight select-none"
      style={{
        boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 240, 255, 0.25)',
      }}
    >
      {/* Windows 11 Toast Header */}
      <div className="px-3.5 pt-3 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src={appLogo}
            alt="Epoch Logo"
            className="w-4 h-4 object-contain rounded-md"
          />
          <span className="text-[11px] font-mono font-bold tracking-wider text-cyan-400">
            EPOCH TRAIL
          </span>
          <span className="text-[10px] text-gray-500 font-mono">Just now</span>
        </div>

        <button
          onClick={() => onCloseRef.current()}
          className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body Content */}
      <div className="px-3.5 py-2 flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-300 shrink-0 shadow-inner">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold text-white font-mono truncate">
            {notification.title}
          </h4>
          <p className="text-[11px] text-gray-300 font-mono mt-0.5 leading-snug truncate">
            {notification.message}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      {notification.clip && onReviewClip && (
        <div className="px-3.5 pb-3 pt-1 flex items-center justify-end gap-2">
          <button
            onClick={() => {
              if (notification.clip) onReviewClip(notification.clip);
              onCloseRef.current();
            }}
            className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-md shadow-cyan-600/30 transition-all"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Review & Draw</span>
          </button>
        </div>
      )}

      {/* Windows 11 Progress Bar */}
      <div className="w-full h-1 bg-black/40">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </aside>
  );
});
