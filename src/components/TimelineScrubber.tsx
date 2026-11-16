import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  Layers,
  Volume2,
  VolumeX,
  Scissors,
  RotateCcw,
  Sparkles,
  Loader2,
  Bookmark,
  Check,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Film
} from 'lucide-react';
import { TacticalAnnotation } from '../types';

function useAudioWaveformPeaks(audioUrl?: string, bins = 96): number[] {
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    if (!audioUrl) {
      setPeaks([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadPeaks = async () => {
      try {
        const resp = await fetch(audioUrl, { signal: controller.signal });
        const arrayBuf = await resp.arrayBuffer();
        if (cancelled || arrayBuf.byteLength === 0) return;

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtxClass) return;

        const ctx = new AudioCtxClass();
        try {
          const decoded = await ctx.decodeAudioData(arrayBuf);
          if (cancelled || decoded.length === 0) return;

          const ch0 = decoded.getChannelData(0);
          const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
          const step = Math.max(1, Math.floor(ch0.length / bins));
          const computed: number[] = [];

          for (let b = 0; b < bins; b++) {
            const start = b * step;
            const end = Math.min(ch0.length, start + step);
            let maxPeak = 0;
            const stride = Math.max(1, Math.floor((end - start) / 64));
            for (let i = start; i < end; i += stride) {
              const v0 = Math.abs(ch0[i]);
              const v1 = ch1 ? Math.abs(ch1[i]) : 0;
              const v = v0 > v1 ? v0 : v1;
              if (v > maxPeak) maxPeak = v;
            }
            computed.push(Math.min(1, Math.max(0.08, Math.pow(maxPeak, 0.7))));
          }
          if (!cancelled) setPeaks(computed);
        } finally {
          try { await ctx.close(); } catch {}
        }
      } catch {
        if (!cancelled) setPeaks([]);
      }
    };

    void loadPeaks();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [audioUrl, bins]);

  return peaks;
}

interface TimelineScrubberProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onStepFrame: (direction: 'prev' | 'next') => void;
  playbackRate: number;
  onChangePlaybackRate: (rate: number) => void;
  playbackVolume: number;
  isMuted: boolean;
  onChangeVolume: (volume: number) => void;
  onToggleMute: () => void;
  annotations: TacticalAnnotation[];
  onSelectAnnotation?: (annotation: TacticalAnnotation) => void;
  trimRange: [number, number];
  onChangeTrimRange: (range: [number, number]) => void;
  onSaveTrimmedClip?: (range: [number, number]) => void;
  isTrimmingSaving?: boolean;
  isFullscreenPlayer?: boolean;
  onToggleFullscreenPlayer?: () => void;
  videoSourceUrl?: string;
  gameAudioUrl?: string;
  micAudioUrl?: string;
  isGameAudioEnabled?: boolean;
  isMicAudioEnabled?: boolean;
  onToggleGameAudio?: () => void;
  onToggleMicAudio?: () => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = React.memo(({
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
  onStepFrame,
  playbackRate,
  onChangePlaybackRate,
  playbackVolume,
  isMuted,
  onChangeVolume,
  onToggleMute,
  annotations,
  onSelectAnnotation,
  trimRange,
  onChangeTrimRange,
  onSaveTrimmedClip,
  isTrimmingSaving = false,
  isFullscreenPlayer,
  onToggleFullscreenPlayer,
  videoSourceUrl,
  gameAudioUrl,
  micAudioUrl,
  isGameAudioEnabled = true,
  isMicAudioEnabled = true,
  onToggleGameAudio,
  onToggleMicAudio,
}) => {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'in' | 'out' | null>(null);

  const hasSeparatedTracks = Boolean(gameAudioUrl || micAudioUrl);
  const gamePeaks = useAudioWaveformPeaks(gameAudioUrl);
  const micPeaks = useAudioWaveformPeaks(micAudioUrl);
  const legacyPeaks = useAudioWaveformPeaks(!hasSeparatedTracks ? videoSourceUrl : undefined);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}.${ms}`;
  };

  const formatTimePrecise = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const trimStart = Math.max(0, Math.min(trimRange[0], duration));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(trimRange[1] || duration, duration));
  const isTrimmed = trimStart > 0.05 || (duration > 0 && trimEnd < duration - 0.05);
  const trimmedDuration = Math.max(0, trimEnd - trimStart);

  const getTimeFromEvent = useCallback((clientX: number) => {
    const timeline = timelineRef.current;
    if (!timeline || duration <= 0) return 0;
    const rect = timeline.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (clickX / rect.width) * duration;
  }, [duration]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingHandle) return;
    const targetTime = getTimeFromEvent(e.clientX);
    onSeek(targetTime);
  };

  // Dragging In / Out Trim Handles
  useEffect(() => {
    if (!draggingHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromEvent(e.clientX);
      if (draggingHandle === 'in') {
        const newStart = Math.min(time, trimEnd - 0.2);
        onChangeTrimRange([Math.max(0, newStart), trimEnd]);
        onSeek(Math.max(0, newStart));
      } else if (draggingHandle === 'out') {
        const newEnd = Math.max(time, trimStart + 0.2);
        onChangeTrimRange([trimStart, Math.min(duration, newEnd)]);
        onSeek(Math.min(duration, newEnd));
      }
    };

    const handleMouseUp = () => {
      setDraggingHandle(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingHandle, duration, getTimeFromEvent, onChangeTrimRange, onSeek, trimEnd, trimStart]);

  // Set In / Set Out point actions
  const handleSetInPoint = () => {
    const newStart = Math.min(currentTime, trimEnd - 0.2);
    onChangeTrimRange([Math.max(0, newStart), trimEnd]);
  };

  const handleSetOutPoint = () => {
    const newEnd = Math.max(currentTime, trimStart + 0.2);
    onChangeTrimRange([trimStart, Math.min(duration, newEnd)]);
  };

  const handleResetTrim = () => {
    onChangeTrimRange([0, duration]);
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const inPercent = duration > 0 ? (trimStart / duration) * 100 : 0;
  const outPercent = duration > 0 ? (trimEnd / duration) * 100 : 100;
  const activeSpanPercent = Math.max(0, outPercent - inPercent);

  return (
    <div className="w-full bg-[#080d16]/98 backdrop-blur-xl border-t border-white/10 px-4 py-3 flex flex-col gap-2.5 shadow-2xl select-none z-20 font-mono">
      {/* 1. Timeline Track + Separated Audio Track Layers */}
      <div className="space-y-1.5">
        {/* Video Slider Row */}
        <div className="flex items-center gap-2">
          <div className="w-40 shrink-0 h-8 px-2.5 rounded-lg bg-black/50 border border-white/10 flex items-center gap-1.5 text-[10px] font-bold text-gray-300">
            <Film className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">VIDEO TRACK</span>
          </div>

          <div
            ref={timelineRef}
            onClick={handleTimelineClick}
            className="relative flex-1 h-8 bg-black/60 rounded-xl overflow-hidden cursor-pointer border border-white/10 flex items-center group shadow-inner"
          >
            {/* Background Grid Lines for Frame Increments */}
            <div className="absolute inset-0 flex justify-between pointer-events-none opacity-15">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className="w-[1px] h-full bg-white" />
              ))}
            </div>

            {/* Dimmed Non-Trimmed Left Area */}
            {inPercent > 0 && (
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/60 z-0 border-r border-dashed border-emerald-500/40"
                style={{ width: `${inPercent}%` }}
              />
            )}

            {/* Active Trimmed Region Highlight */}
            <div
              className="absolute top-0 bottom-0 bg-cyan-950/40 border-y border-cyan-400/50 z-0 shadow-lg shadow-cyan-500/10 transition-all duration-75"
              style={{
                left: `${inPercent}%`,
                width: `${activeSpanPercent}%`,
              }}
            >
              <div className="w-full h-full bg-gradient-to-r from-cyan-500/15 via-blue-500/20 to-cyan-500/15" />
            </div>

            {/* Dimmed Non-Trimmed Right Area */}
            {outPercent < 100 && (
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/60 z-0 border-l border-dashed border-red-500/40"
                style={{ width: `${100 - outPercent}%` }}
              />
            )}

            {/* Played Progress Bar within Trimmed Region */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-blue-600/40 to-cyan-500/40 pointer-events-none z-0"
              style={{ width: `${progressPercent}%` }}
            />

            {/* Annotation Markers / Pips */}
            {annotations.map(ann => {
              const markerPercent = duration > 0 ? (ann.timestamp / duration) * 100 : 0;
              return (
                <button
                  key={ann.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(ann.timestamp);
                    if (onSelectAnnotation) onSelectAnnotation(ann);
                  }}
                  title={`Jump to sketch at ${formatTimePrecise(ann.timestamp)} (${ann.tool})`}
                  className="absolute top-1/2 -translate-y-1/2 -ml-1 w-2.5 h-4 rounded-sm border border-white shadow-md transition-transform hover:scale-125 z-10"
                  style={{
                    left: `${markerPercent}%`,
                    backgroundColor: ann.color,
                  }}
                />
              );
            })}

            {/* Draggable In-Point [ Bracket Handle */}
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                setDraggingHandle('in');
              }}
              title={`Trim Start [In]: ${formatTimePrecise(trimStart)} (Drag or press 'I')`}
              className="absolute top-0 bottom-0 -ml-2 w-4 z-20 flex items-center justify-start cursor-ew-resize group/in"
              style={{ left: `${inPercent}%` }}
            >
              <div className="w-3 h-full bg-emerald-500 rounded-l-md flex flex-col items-center justify-center border-l-2 border-y-2 border-emerald-300 shadow-lg shadow-emerald-500/30 group-hover/in:scale-105 transition-transform">
                <span className="text-[9px] font-black text-black leading-none">[</span>
              </div>
              {/* Hover Tooltip */}
              <div className="absolute -top-7 left-0 -translate-x-1/2 px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500 text-emerald-300 text-[10px] font-bold opacity-0 group-hover/in:opacity-100 transition-opacity pointer-events-none shadow-xl whitespace-nowrap">
                In: {formatTimePrecise(trimStart)}
              </div>
            </div>

            {/* Draggable Out-Point ] Bracket Handle */}
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                setDraggingHandle('out');
              }}
              title={`Trim End [Out]: ${formatTimePrecise(trimEnd)} (Drag or press 'O')`}
              className="absolute top-0 bottom-0 -ml-2 w-4 z-20 flex items-center justify-end cursor-ew-resize group/out"
              style={{ left: `${outPercent}%` }}
            >
              <div className="w-3 h-full bg-red-500 rounded-r-md flex flex-col items-center justify-center border-r-2 border-y-2 border-red-300 shadow-lg shadow-red-500/30 group-hover/out:scale-105 transition-transform">
                <span className="text-[9px] font-black text-black leading-none">]</span>
              </div>
              {/* Hover Tooltip */}
              <div className="absolute -top-7 right-0 translate-x-1/2 px-1.5 py-0.5 rounded bg-red-950 border border-red-500 text-red-300 text-[10px] font-bold opacity-0 group-hover/out:opacity-100 transition-opacity pointer-events-none shadow-xl whitespace-nowrap">
                Out: {formatTimePrecise(trimEnd)}
              </div>
            </div>

            {/* Vertical Needle Playhead (NO CIRCLE POINTER) */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-30 flex flex-col items-center"
              style={{ left: `${progressPercent}%`, transform: 'translateX(-50%)' }}
            >
              {/* Sharp Downward Needle Head */}
              <div className="w-3.5 h-2.5 bg-cyan-300 [clip-path:polygon(0%_0%,100%_0%,50%_100%)] shadow-md shadow-cyan-400/80 shrink-0" />
              {/* Full-Height Vertical Needle Bar */}
              <div className="w-[2px] flex-1 bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
            </div>
          </div>
        </div>

        {/* Audio Track Layers Beneath the Video Player Slider (Enable / Disable only) */}
        {hasSeparatedTracks ? (
          <div className="space-y-1">
            {[
              {
                id: 'windows',
                label: 'WINDOWS AUDIO',
                hasAudio: Boolean(gameAudioUrl),
                enabled: isGameAudioEnabled,
                onToggle: onToggleGameAudio,
                peaks: gamePeaks,
                accent: 'cyan' as const,
              },
              {
                id: 'mic',
                label: 'MIC AUDIO',
                hasAudio: Boolean(micAudioUrl),
                enabled: isMicAudioEnabled,
                onToggle: onToggleMicAudio,
                peaks: micPeaks,
                accent: 'emerald' as const,
              },
            ].map(track => {
              const active = track.hasAudio && track.enabled;
              const barColor = !track.hasAudio
                ? 'bg-gray-800/50'
                : !track.enabled
                ? 'bg-gray-700/40'
                : track.accent === 'cyan'
                ? 'bg-cyan-400/75'
                : 'bg-emerald-400/75';

              return (
                <div key={track.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!track.hasAudio}
                    onClick={track.onToggle}
                    title={
                      !track.hasAudio
                        ? `${track.label} not recorded in this clip`
                        : track.enabled
                        ? `Disable ${track.label}`
                        : `Enable ${track.label}`
                    }
                    className={`w-40 shrink-0 h-7 px-2.5 rounded-lg border flex items-center justify-between gap-1.5 text-[10px] font-bold transition-colors ${
                      !track.hasAudio
                        ? 'bg-black/40 border-white/5 text-gray-600 cursor-not-allowed'
                        : track.enabled
                        ? track.accent === 'cyan'
                          ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/70'
                          : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/70'
                        : 'bg-black/50 border-white/10 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {track.id === 'windows' ? (
                        active ? <Volume2 className="w-3 h-3 text-cyan-400 shrink-0" /> : <VolumeX className="w-3 h-3 shrink-0" />
                      ) : (
                        active ? <Mic className="w-3 h-3 text-emerald-400 shrink-0" /> : <MicOff className="w-3 h-3 shrink-0" />
                      )}
                      <span className="truncate">{track.label}</span>
                    </div>
                    <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${
                      !track.hasAudio
                        ? 'bg-white/5 text-gray-600'
                        : track.enabled
                        ? track.accent === 'cyan'
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/15 text-red-400'
                    }`}>
                      {!track.hasAudio ? 'NONE' : track.enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <div
                    onClick={handleTimelineClick}
                    className={`relative flex-1 h-7 rounded-lg overflow-hidden cursor-pointer border flex items-center px-0.5 ${
                      active
                        ? 'bg-black/55 border-white/10'
                        : 'bg-black/35 border-white/5 opacity-55'
                    }`}
                  >
                    {/* Active Trimmed Region Highlight */}
                    <div
                      className="absolute top-0 bottom-0 bg-white/[0.03] pointer-events-none"
                      style={{ left: `${inPercent}%`, width: `${activeSpanPercent}%` }}
                    />

                    {/* Waveform Bars */}
                    <div className="relative z-10 w-full h-full flex items-center justify-between gap-[1px] pointer-events-none">
                      {track.hasAudio ? (
                        (track.peaks.length > 0 ? track.peaks : Array.from({ length: 64 }, () => 0.14)).map((peak, idx) => (
                          <div
                            key={idx}
                            className={`flex-1 rounded-full transition-colors ${barColor}`}
                            style={{ height: `${Math.round(peak * 82)}%` }}
                          />
                        ))
                      ) : (
                        <div className="w-full h-[1px] bg-white/10" />
                      )}
                    </div>

                    {/* Playhead Line */}
                    <div
                      className="absolute top-0 bottom-0 w-[1.5px] bg-cyan-300/80 pointer-events-none z-20"
                      style={{ left: `${progressPercent}%`, transform: 'translateX(-50%)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleGameAudio}
              title={isGameAudioEnabled ? 'Disable Clip Audio' : 'Enable Clip Audio'}
              className={`w-40 shrink-0 h-7 px-2.5 rounded-lg border flex items-center justify-between gap-1.5 text-[10px] font-bold transition-colors ${
                isGameAudioEnabled
                  ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/70'
                  : 'bg-black/50 border-white/10 text-gray-500 hover:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isGameAudioEnabled ? (
                  <Volume2 className="w-3 h-3 text-cyan-400 shrink-0" />
                ) : (
                  <VolumeX className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate">CLIP AUDIO</span>
              </div>
              <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${
                isGameAudioEnabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-red-500/15 text-red-400'
              }`}>
                {isGameAudioEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            <div
              onClick={handleTimelineClick}
              className={`relative flex-1 h-7 rounded-lg overflow-hidden cursor-pointer border flex items-center px-0.5 ${
                isGameAudioEnabled
                  ? 'bg-black/55 border-white/10'
                  : 'bg-black/35 border-white/5 opacity-55'
              }`}
            >
              <div
                className="relative z-10 w-full h-full flex items-center justify-between gap-[1px] pointer-events-none"
              >
                {(legacyPeaks.length > 0 ? legacyPeaks : Array.from({ length: 64 }, () => 0.14)).map((peak, idx) => (
                  <div
                    key={idx}
                    className={`flex-1 rounded-full transition-colors ${
                      isGameAudioEnabled ? 'bg-cyan-400/75' : 'bg-gray-700/40'
                    }`}
                    style={{ height: `${Math.round(peak * 82)}%` }}
                  />
                ))}
              </div>
              <div
                className="absolute top-0 bottom-0 w-[1.5px] bg-cyan-300/80 pointer-events-none z-20"
                style={{ left: `${progressPercent}%`, transform: 'translateX(-50%)' }}
              />
            </div>
          </div>
        )}

        {/* Trim Range Timecodes Bar */}
        <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono px-1">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold">In: {formatTimePrecise(trimStart)}</span>
            <span className="text-gray-600">•</span>
            <span className="text-red-400 font-bold">Out: {formatTimePrecise(trimEnd)}</span>
            <span className="text-gray-600">•</span>
            <span className={isTrimmed ? 'text-cyan-300 font-bold bg-cyan-950/70 px-1.5 py-0.5 rounded border border-cyan-800/60' : 'text-gray-400'}>
              Duration: {trimmedDuration.toFixed(1)}s {isTrimmed ? '(Trimmed)' : '(Full)'}
            </span>
          </div>

          <div className="text-[10px] text-gray-500 flex items-center gap-2">
            <span>Tip: Drag <strong className="text-emerald-400">[</strong> and <strong className="text-red-400">]</strong> or press <kbd className="px-1 py-0.5 rounded bg-white/10 text-white">I</kbd> / <kbd className="px-1 py-0.5 rounded bg-white/10 text-white">O</kbd></span>
          </div>
        </div>
      </div>

      {/* 2. Media & Trimming Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-300">
        {/* Left: Playback & Step Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSeek(trimStart)}
            title="Jump to Trim In-Point"
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={() => onStepFrame('prev')}
            title="Step 1 Frame Backward (← / J)"
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={onPlayPause}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
              isPlaying
                ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40 hover:bg-cyan-900'
                : 'bg-cyan-600 text-white hover:bg-cyan-500 shadow-md shadow-cyan-600/30'
            }`}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
            <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
          </button>

          <button
            onClick={() => onStepFrame('next')}
            title="Step 1 Frame Forward (→ / L)"
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Timecode display */}
          <div className="ml-2 px-2.5 py-1 bg-black/60 border border-white/10 rounded-lg text-xs tracking-wider">
            <span className="text-cyan-400 font-bold">{formatTimePrecise(currentTime)}</span>
            <span className="text-gray-500 mx-1">/</span>
            <span className="text-gray-400">{formatTimePrecise(duration)}</span>
          </div>
        </div>

        {/* Center: Trimming Actions */}
        <div className="flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-xl p-1">
          <button
            onClick={handleSetInPoint}
            title="Set In-Point at playhead (Hotkey: I)"
            className="px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1 transition-all"
          >
            <span>[ Set In</span>
            <kbd className="text-[9px] bg-black/40 px-1 rounded text-emerald-400">I</kbd>
          </button>

          <button
            onClick={handleSetOutPoint}
            title="Set Out-Point at playhead (Hotkey: O)"
            className="px-2.5 py-1 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-500/40 text-xs font-bold flex items-center gap-1 transition-all"
          >
            <span>Set Out ]</span>
            <kbd className="text-[9px] bg-black/40 px-1 rounded text-red-400">O</kbd>
          </button>

          {isTrimmed && (
            <button
              onClick={handleResetTrim}
              title="Reset Trim Range to Full Duration"
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Save / Generate New Clip from Trimmed Part */}
          {onSaveTrimmedClip && (
            <button
              onClick={() => onSaveTrimmedClip([trimStart, trimEnd])}
              disabled={isTrimmingSaving || trimmedDuration < 0.2}
              title="Extract the selected trim region and generate a new clip in your Vault"
              className="ml-1 px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-cyan-600/30 transition-all disabled:opacity-50"
            >
              {isTrimmingSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Trimming...</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Save Trimmed Clip</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Right: Audio Volume + Playback Speed */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 border-r border-white/10 pr-2.5">
            <button
              onClick={onToggleMute}
              title={isMuted ? 'Unmute playback' : 'Mute playback'}
              className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {isMuted || playbackVolume === 0
                ? <VolumeX className="w-4 h-4" />
                : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : playbackVolume}
              onChange={event => onChangeVolume(Number(event.target.value))}
              title={`Playback volume ${Math.round((isMuted ? 0 : playbackVolume) * 100)}%`}
              aria-label="Playback volume"
              className="w-16 accent-cyan-500"
            />
          </div>

          <div className="flex items-center gap-1">
            {[0.5, 1.0, 2.0].map(rate => (
              <button
                key={rate}
                onClick={() => onChangePlaybackRate(rate)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  playbackRate === rate
                    ? 'bg-cyan-600 text-white font-bold shadow-sm'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {onToggleFullscreenPlayer && (
            <button
              onClick={onToggleFullscreenPlayer}
              title={isFullscreenPlayer ? "Exit Fullscreen Theater (F / Esc)" : "Fullscreen Player (F)"}
              className={`p-1.5 rounded-lg border transition-colors ${
                isFullscreenPlayer
                  ? 'bg-cyan-600/30 border-cyan-400 text-cyan-300'
                  : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              {isFullscreenPlayer ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
