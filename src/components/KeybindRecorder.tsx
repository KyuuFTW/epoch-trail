import React, { useState, useEffect, useRef } from 'react';
import { Keyboard, Edit3, Check } from 'lucide-react';

interface KeybindRecorderProps {
  label: string;
  value: string;
  onChange: (newValue: string) => void;
  description?: string;
}

export const KeybindRecorder: React.FC<KeybindRecorderProps> = ({
  label,
  value,
  onChange,
  description,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isDirectEditing, setIsDirectEditing] = useState(false);
  const [textValue, setTextValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  // Handle interactive keyboard capture mode
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Don't record modifier keys alone
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setIsRecording(false);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      let keyName = e.key;
      if (e.code.startsWith('Key')) {
        keyName = e.code.replace('Key', '');
      } else if (e.code.startsWith('Digit')) {
        keyName = e.code.replace('Digit', '');
      } else if (e.code.startsWith('F') && e.code.length <= 3) {
        keyName = e.code;
      } else if (e.code === 'Space') {
        keyName = 'Space';
      } else if (e.code === 'ArrowLeft') {
        keyName = 'ArrowLeft';
      } else if (e.code === 'ArrowRight') {
        keyName = 'ArrowRight';
      } else if (e.code === 'ArrowUp') {
        keyName = 'ArrowUp';
      } else if (e.code === 'ArrowDown') {
        keyName = 'ArrowDown';
      } else if (e.code === 'Delete') {
        keyName = 'Delete';
      } else if (e.code === 'Backspace') {
        keyName = 'Backspace';
      } else if (e.code === 'Tab') {
        keyName = 'Tab';
      }

      parts.push(keyName);
      const combined = parts.join('+');

      setTextValue(combined);
      onChange(combined);
      setIsRecording(false);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isRecording, onChange]);

  const handleSaveDirectEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textValue.trim()) {
      onChange(textValue.trim());
    } else {
      setTextValue(value);
    }
    setIsDirectEditing(false);
  };

  return (
    <div className="flex items-center justify-between p-3 bg-black/40 border border-white/10 rounded-xl hover:border-white/20 transition-all">
      <div className="flex-1 pr-3">
        <div className="text-xs font-bold text-white font-mono">{label}</div>
        {description && <div className="text-[11px] text-gray-400 mt-0.5">{description}</div>}
      </div>

      <div className="flex items-center gap-2">
        {isDirectEditing ? (
          <form onSubmit={handleSaveDirectEdit} className="flex items-center gap-1">
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onBlur={handleSaveDirectEdit}
              placeholder="e.g. F8 or Alt+Shift+T"
              className="bg-black/90 border border-red-500 rounded px-2 py-1 text-xs font-mono font-bold text-white outline-none w-32 shadow-inner"
            />
            <button
              type="submit"
              className="p-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* Record / Key Display Button */}
            <button
              type="button"
              onClick={() => setIsRecording(true)}
              title="Click and press keys on your keyboard"
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                isRecording
                  ? 'bg-red-600 text-white ring-2 ring-red-400 animate-pulse shadow-lg shadow-red-600/50'
                  : 'bg-white/10 text-gray-200 hover:bg-white/20 hover:text-white border border-white/10 shadow-sm'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5 text-red-400" />
              <span>{isRecording ? 'Press Keys...' : value}</span>
            </button>

            {/* Direct Edit Pencil Button */}
            <button
              type="button"
              onClick={() => setIsDirectEditing(true)}
              title="Type shortcut directly"
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white border border-white/5 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
