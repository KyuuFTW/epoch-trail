import React, { useState } from 'react';
import { AppWindow, Monitor, ChevronRight, Layers } from 'lucide-react';
import { CaptureSourceConfig } from '../types';
import { CaptureSourceModal } from './CaptureSourceModal';

interface CaptureSourcePickerProps {
  value: CaptureSourceConfig;
  disabled?: boolean;
  onChange: (source: CaptureSourceConfig) => void;
}

export const CaptureSourcePicker: React.FC<CaptureSourcePickerProps> = ({
  value,
  disabled = false,
  onChange,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const label = value.sourceName || (value.mode === 'window' ? 'Choose Window' : 'Primary Monitor');
  const isWindow = value.mode === 'window' || value.sourceId?.startsWith('window:');

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsModalOpen(true)}
        title={disabled ? 'Stop the rolling buffer before changing capture source' : 'Click to select screen or window to record'}
        className="w-full flex items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-[#080c14] hover:bg-[#0c121e] px-3 py-2.5 text-left transition-all hover:border-cyan-500/60 group shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-cyan-400 group-hover:border-cyan-500/50 transition-colors shrink-0">
            {isWindow ? (
              <AppWindow className="w-4 h-4" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 font-mono flex items-center gap-1">
              <span>TARGET</span>
              <span className="text-cyan-400">• {isWindow ? 'WINDOW' : 'DISPLAY'}</span>
            </div>
            <div className="truncate text-xs text-white font-bold font-mono group-hover:text-cyan-300 transition-colors" title={label}>
              {label}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all shrink-0" />
      </button>

      {/* Full-Fidelity Source Selection Pop-up Modal */}
      <CaptureSourceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </>
  );
};
