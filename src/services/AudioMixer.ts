import { AudioConfig, AudioDevice } from '../types';

export interface SeparatedAudioTracks {
  gameAudioTrack: MediaStreamTrack | null;
  micAudioTrack: MediaStreamTrack | null;
}

const NOISE_GATE_WORKLET_NAME = 'epoch-noise-gate';

const NOISE_GATE_WORKLET_CODE = `
class EpochNoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.thresholdDb = -42;
    this.currentGain = 1.0;
    this.isGateOpen = true;
    this.holdFramesRemaining = 0;
    this.meterFrames = 0;
    this.peakDb = -80;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
      if (typeof data.thresholdDb === 'number') this.thresholdDb = data.thresholdDb;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!input || input.length === 0) {
      for (let ch = 0; ch < output.length; ch++) {
        output[ch].fill(0);
      }
      return true;
    }

    const frameCount = output[0].length;
    const channelCount = input.length;

    let sumSq = 0;
    let totalSamples = 0;
    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      if (!inCh) continue;
      for (let i = 0; i < inCh.length; i++) {
        const s = inCh[i];
        sumSq += s * s;
      }
      totalSamples += inCh.length;
    }

    const rms = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;
    const db = Math.max(-80, Math.round(20 * Math.log10(Math.max(rms, 0.0001))));
    if (db > this.peakDb) this.peakDb = db;

    const holdSamples = Math.round(sampleRate * 0.12);
    const attackCoeff = Math.exp(-1 / Math.max(1, sampleRate * 0.008));
    const releaseCoeff = Math.exp(-1 / Math.max(1, sampleRate * 0.045));

    let targetGain = 1.0;
    if (this.enabled) {
      if (db >= this.thresholdDb) {
        this.holdFramesRemaining = holdSamples;
        this.isGateOpen = true;
        targetGain = 1.0;
      } else if (this.holdFramesRemaining > 0) {
        this.holdFramesRemaining = Math.max(0, this.holdFramesRemaining - frameCount);
        this.isGateOpen = true;
        targetGain = 1.0;
      } else {
        this.isGateOpen = false;
        targetGain = 0.0;
      }
    } else {
      this.isGateOpen = true;
      targetGain = 1.0;
    }

    const coeff = targetGain > this.currentGain ? attackCoeff : releaseCoeff;
    let g = this.currentGain;
    for (let i = 0; i < frameCount; i++) {
      g = targetGain + (g - targetGain) * coeff;
      for (let ch = 0; ch < output.length; ch++) {
        const srcCh = input[Math.min(ch, channelCount - 1)];
        output[ch][i] = srcCh ? srcCh[i] * g : 0;
      }
    }
    this.currentGain = g;

    this.meterFrames += frameCount;
    if (this.meterFrames >= Math.round(sampleRate * 0.04)) {
      this.meterFrames = 0;
      const reportedDb = this.peakDb;
      this.peakDb = -80;
      this.port.postMessage({
        db: reportedDb,
        isGateOpen: this.isGateOpen,
      });
    }

    return true;
  }
}
registerProcessor('${NOISE_GATE_WORKLET_NAME}', EpochNoiseGateProcessor);
`;

export class AudioMixerService {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private micGateGainNode: GainNode | null = null;
  private micGateWorkletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micHighPassNode: BiquadFilterNode | null = null;
  private micHighShelfNode: BiquadFilterNode | null = null;
  private micCompressorNode: DynamicsCompressorNode | null = null;
  private levelIntervalId: number | null = null;
  private levelListeners: ((data: { level: number; isGateOpen: boolean; db: number }) => void)[] = [];
  private gameLevelListeners: ((data: { level: number; db: number }) => void)[] = [];

  private lastSpeechTime = 0;
  private currentGateOpen = true;
  private isInitializing = false;
  private liveGameTrackAvailable = false;

  private config: AudioConfig = {
    gameVolume: 1.0,
    micVolume: 1.0,
    micDeviceId: 'default',
    playbackDeviceId: 'default',
    audioSourceMode: 'system',
    isGameAudioMuted: false,
    isMicMuted: false,
    micNoiseSuppression: true,
    noiseGateEnabled: true,
    noiseGateThresholdDb: -42,
    antiStaticFilter: true,
    audioBitrate: 256_000,
    audioSampleRate: 48_000,
    bypassAudioFilters: false,
  };

  constructor() {
    // Lazy audio context initialization on first interaction
  }

  public getConfig(): AudioConfig {
    return { ...this.config };
  }

  public setConfig(config: Partial<AudioConfig>): void {
    this.config = { ...this.config, ...config };
    this.setGameVolume(this.config.gameVolume);
    this.setMicVolume(this.config.micVolume);
    this.syncGateWorkletConfig();
  }

  public async getAvailableMicrophones(): Promise<AudioDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      return audioInputs.map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1}`,
      }));
    } catch (e) {
      console.warn('Could not enumerate audio devices:', e);
      return [{ deviceId: 'default', label: 'Default Microphone' }];
    }
  }

  public async getAvailableAudioOutputs(): Promise<AudioDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
      const list: AudioDevice[] = [
        { deviceId: 'default', label: 'Default System Output (Speakers / Headphones)' },
      ];
      audioOutputs.forEach((d, index) => {
        if (d.deviceId && d.deviceId !== 'default') {
          list.push({
            deviceId: d.deviceId,
            label: d.label || `Output Device ${index + 1}`,
          });
        }
      });
      return list;
    } catch (e) {
      console.warn('Could not enumerate audio output devices:', e);
      return [{ deviceId: 'default', label: 'Default System Output' }];
    }
  }

  /**
   * Separates Window/System audio and Microphone audio cleanly before filtering:
   * - Window/System audio stays untouched as its own independent track (zero Web Audio DSP).
   * - Microphone audio is captured independently and filtered on its own Web Audio graph
   *   (85Hz high-pass, 13.5kHz high-shelf, vocal compressor, and audio-thread noise gate).
   */
  public async prepareAudioTracks(
    gameAudioTrack?: MediaStreamTrack | null,
    audioConfig?: Partial<AudioConfig>,
  ): Promise<SeparatedAudioTracks> {
    this.isInitializing = true;
    try {
      this.cleanup();

      if (audioConfig) {
        this.config = { ...this.config, ...audioConfig };
      }

      const hasLiveGameTrack = Boolean(
        gameAudioTrack && gameAudioTrack.kind === 'audio' && gameAudioTrack.readyState === 'live',
      );
      this.liveGameTrackAvailable = hasLiveGameTrack;
      // Keep the raw Window/System track wired when available so muting/unmuting
      // during capture is instantaneous with zero buffer restart.
      const outGameTrack = hasLiveGameTrack ? (gameAudioTrack || null) : null;

      if (this.config.isMicMuted) {
        return { gameAudioTrack: outGameTrack, micAudioTrack: null };
      }

      const outMicTrack = await this.initFilteredMicTrack();
      return {
        gameAudioTrack: outGameTrack,
        micAudioTrack: outMicTrack,
      };
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Legacy single-track helper kept for WebM MediaRecorder fallback.
   * Prefers separated tracks via prepareAudioTracks() for Mp4RollingEncoder.
   */
  public async initAudioMixer(
    gameAudioTrack?: MediaStreamTrack | null,
    audioConfig?: Partial<AudioConfig>,
  ): Promise<MediaStreamTrack | null> {
    const { gameAudioTrack: gameTrack, micAudioTrack: micTrack } = await this.prepareAudioTracks(
      gameAudioTrack,
      audioConfig,
    );
    const activeGameTrack = this.config.isGameAudioMuted ? null : gameTrack;
    return activeGameTrack || micTrack || null;
  }

  private async initFilteredMicTrack(): Promise<MediaStreamTrack | null> {
    try {
      const useAiNoiseSuppression = this.config.micNoiseSuppression && !this.config.bypassAudioFilters;
      const micConstraints: MediaTrackConstraints = {
        // Never enable WebRTC echoCancellation alongside WASAPI loopback audio;
        // AEC3 fights playback audio and causes robotic artifacts and dropouts.
        echoCancellation: false,
        noiseSuppression: useAiNoiseSuppression,
        autoGainControl: false,
      };
      if (this.config.micDeviceId && this.config.micDeviceId !== 'default') {
        micConstraints.deviceId = { exact: this.config.micDeviceId };
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints,
        video: false,
      });

      const rawMicTrack = this.micStream.getAudioTracks()[0];
      if (!rawMicTrack || rawMicTrack.readyState !== 'live') {
        return null;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        return rawMicTrack;
      }

      const configuredRate = this.config.audioSampleRate || 48_000;
      const micTrackRate = rawMicTrack.getSettings()?.sampleRate;
      const targetSampleRate = configuredRate > 48_000
        ? (micTrackRate === 44_100 || micTrackRate === 48_000 ? micTrackRate : 48_000)
        : configuredRate;

      try {
        this.audioContext = new AudioContextClass({ sampleRate: targetSampleRate });
      } catch {
        this.audioContext = new AudioContextClass();
      }

      this.audioContext.onstatechange = () => {
        if (this.audioContext && this.audioContext.state === 'suspended' && !this.isInitializing) {
          void this.audioContext.resume().catch(() => undefined);
        }
      };

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      if (this.audioContext.state !== 'running') {
        console.warn('Mic AudioContext is not running; using raw microphone track.');
        this.closeAudioContextOnly();
        return rawMicTrack;
      }

      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.destinationNode.channelCount = 2;
      this.destinationNode.channelCountMode = 'explicit';
      this.destinationNode.channelInterpretation = 'speakers';

      this.micSourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.micGainNode = this.audioContext.createGain();
      this.micGainNode.channelCount = 2;
      this.micGainNode.channelCountMode = 'explicit';
      this.micGainNode.channelInterpretation = 'speakers';
      this.micGainNode.gain.value = this.config.isMicMuted ? 0 : this.config.micVolume;

      let lastMicNode: AudioNode = this.micSourceNode;

      // Apply Anti-Static, Hum Removal, and Voice Leveler DSP strictly on the isolated Mic track
      if (this.config.antiStaticFilter && !this.config.bypassAudioFilters) {
        // 1. High-pass filter at 85Hz: Cuts 50/60Hz AC electrical hum & fan rumble
        this.micHighPassNode = this.audioContext.createBiquadFilter();
        this.micHighPassNode.type = 'highpass';
        this.micHighPassNode.frequency.value = 85;
        this.micHighPassNode.Q.value = 0.707;

        // 2. High-shelf filter at 13.5kHz: Soft roll-off (-3.5dB) to tame USB preamp hiss
        this.micHighShelfNode = this.audioContext.createBiquadFilter();
        this.micHighShelfNode.type = 'highshelf';
        this.micHighShelfNode.frequency.value = 13500;
        this.micHighShelfNode.gain.value = -3.5;

        // 3. Transparent Voice Leveler Compressor
        this.micCompressorNode = this.audioContext.createDynamicsCompressor();
        this.micCompressorNode.threshold.value = -22;
        this.micCompressorNode.knee.value = 10;
        this.micCompressorNode.ratio.value = 3;
        this.micCompressorNode.attack.value = 0.004;
        this.micCompressorNode.release.value = 0.12;

        lastMicNode.connect(this.micHighPassNode);
        this.micHighPassNode.connect(this.micHighShelfNode);
        this.micHighShelfNode.connect(this.micCompressorNode);
        lastMicNode = this.micCompressorNode;
      }

      // Attach Adaptive Noise Gate on the audio thread (pre-gain, never post-gate)
      const gateAttached = await this.attachNoiseGate(lastMicNode);
      if (!gateAttached) {
        this.micAnalyser = this.audioContext.createAnalyser();
        this.micAnalyser.fftSize = 256;
        this.micAnalyser.smoothingTimeConstant = 0.2;

        this.micGateGainNode = this.audioContext.createGain();
        this.micGateGainNode.gain.value = 1.0;
        this.currentGateOpen = true;
        this.lastSpeechTime = performance.now();

        lastMicNode.connect(this.micAnalyser);
        lastMicNode.connect(this.micGateGainNode);
        this.micGateGainNode.connect(this.micGainNode);
        this.startFallbackLevelMonitoring();
      }

      this.micGainNode.connect(this.destinationNode);

      const processedTracks = this.destinationNode.stream.getAudioTracks();
      return processedTracks.length > 0 ? processedTracks[0] : rawMicTrack;
    } catch (micErr) {
      console.warn('Microphone permission not granted or device busy:', micErr);
      return null;
    }
  }

  private async attachNoiseGate(lastMicNode: AudioNode): Promise<boolean> {
    if (!this.audioContext || !this.micGainNode || !this.audioContext.audioWorklet) {
      return false;
    }

    let workletUrl: string | null = null;
    try {
      const blob = new Blob([NOISE_GATE_WORKLET_CODE], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);
      await this.audioContext.audioWorklet.addModule(workletUrl);

      if (!this.audioContext || !this.micGainNode) return false;

      this.micGateWorkletNode = new AudioWorkletNode(this.audioContext, NOISE_GATE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.syncGateWorkletConfig();

      this.micGateWorkletNode.port.onmessage = (event) => {
        const data = event.data as { db?: number; isGateOpen?: boolean } | undefined;
        if (!data || typeof data.db !== 'number') return;
        this.currentGateOpen = this.config.isMicMuted ? false : Boolean(data.isGateOpen);
        if (this.levelListeners.length === 0) return;

        if (this.config.isMicMuted) {
          this.levelListeners.forEach(fn => fn({ level: 0, isGateOpen: false, db: -80 }));
          return;
        }

        const normalized = Math.min(1, Math.max(0, (data.db + 60) / 60));
        const payload = {
          level: normalized,
          isGateOpen: this.currentGateOpen,
          db: data.db,
        };
        this.levelListeners.forEach(fn => fn(payload));
      };

      lastMicNode.connect(this.micGateWorkletNode);
      this.micGateWorkletNode.connect(this.micGainNode);
      return true;
    } catch (err) {
      console.warn('AudioWorklet noise gate unavailable, using fallback gate:', err);
      this.micGateWorkletNode = null;
      return false;
    } finally {
      if (workletUrl) {
        URL.revokeObjectURL(workletUrl);
      }
    }
  }

  private syncGateWorkletConfig(): void {
    const gateActive = Boolean(this.config.noiseGateEnabled && !this.config.bypassAudioFilters);
    const thresholdDb = this.config.noiseGateThresholdDb ?? -42;
    if (this.micGateWorkletNode) {
      this.micGateWorkletNode.port.postMessage({
        enabled: gateActive,
        thresholdDb,
      });
    }
    if (!gateActive && this.micGateGainNode && this.audioContext) {
      this.micGateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
    }
  }

  public setGameVolume(volume: number): void {
    this.config.gameVolume = Math.max(0, Math.min(1, volume));
  }

  public setGameAudioMuted(muted: boolean): void {
    this.config.isGameAudioMuted = muted;
    if (muted) {
      this.reportGameAudioLevel(-80);
    }
  }

  public setMicVolume(volume: number): void {
    this.config.micVolume = Math.max(0, Math.min(1, volume));
    if (this.micGainNode && this.audioContext) {
      const targetGain = this.config.isMicMuted ? 0 : this.config.micVolume;
      this.micGainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
    }
  }

  public setMicMuted(muted: boolean): void {
    this.config.isMicMuted = muted;
    this.setMicVolume(this.config.micVolume);
    if (muted && this.levelListeners.length > 0) {
      this.levelListeners.forEach(fn => fn({ level: 0, isGateOpen: false, db: -80 }));
    }
  }

  public hasLiveMic(): boolean {
    return Boolean(this.micStream && this.micStream.getAudioTracks().some(t => t.readyState === 'live'));
  }

  public hasLiveGameTrack(): boolean {
    return this.liveGameTrackAvailable;
  }

  public reportGameAudioLevel(db: number): void {
    if (this.gameLevelListeners.length === 0) return;
    const clampedDb = Math.max(-80, Math.min(0, Math.round(db)));
    const normalized = this.config.isGameAudioMuted
      ? 0
      : Math.min(1, Math.max(0, (clampedDb + 60) / 60));
    const payload = {
      level: normalized,
      db: this.config.isGameAudioMuted ? -80 : clampedDb,
    };
    this.gameLevelListeners.forEach(fn => fn(payload));
  }

  public onGameLevelChange(callback: (data: { level: number; db: number }) => void): () => void {
    this.gameLevelListeners.push(callback);
    return () => {
      this.gameLevelListeners = this.gameLevelListeners.filter(l => l !== callback);
    };
  }

  public setMicNoiseSuppression(enabled: boolean): void {
    this.config.micNoiseSuppression = enabled;
  }

  public setNoiseGateEnabled(enabled: boolean): void {
    this.config.noiseGateEnabled = enabled;
    this.syncGateWorkletConfig();
  }

  public setNoiseGateThreshold(thresholdDb: number): void {
    this.config.noiseGateThresholdDb = thresholdDb;
    this.syncGateWorkletConfig();
  }

  public setAudioSourceMode(mode: 'system' | 'window'): void {
    this.config.audioSourceMode = mode;
  }

  public async setMicDevice(deviceId: string, gameTrack?: MediaStreamTrack | null): Promise<void> {
    this.config.micDeviceId = deviceId;
    await this.initAudioMixer(gameTrack, this.config);
  }

  public onMicLevelChange(callback: (data: { level: number; isGateOpen: boolean; db: number }) => void): () => void {
    this.levelListeners.push(callback);
    return () => {
      this.levelListeners = this.levelListeners.filter(l => l !== callback);
    };
  }

  private startFallbackLevelMonitoring(): void {
    if (!this.micAnalyser) return;
    const timeDomainData = new Uint8Array(this.micAnalyser.fftSize);

    const update = () => {
      if (!this.micAnalyser || !this.audioContext) return;

      this.micAnalyser.getByteTimeDomainData(timeDomainData);
      let sumSq = 0;
      for (let i = 0; i < timeDomainData.length; i++) {
        const sample = (timeDomainData[i] - 128) / 128;
        sumSq += sample * sample;
      }
      const rms = Math.sqrt(sumSq / timeDomainData.length);
      const currentDb = Math.max(-80, Math.round(20 * Math.log10(Math.max(rms, 0.0001))));
      const normalized = Math.min(1, Math.max(0, (currentDb + 60) / 60));

      const gateActive = Boolean(this.config.noiseGateEnabled && !this.config.bypassAudioFilters);
      if (gateActive && this.micGateGainNode) {
        const thresholdDb = this.config.noiseGateThresholdDb ?? -42;
        const now = performance.now();

        if (currentDb >= thresholdDb) {
          this.lastSpeechTime = now;
          if (!this.currentGateOpen) {
            this.currentGateOpen = true;
            this.micGateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
          }
        } else {
          const holdTimeMs = 120;
          if (now - this.lastSpeechTime > holdTimeMs && this.currentGateOpen) {
            this.currentGateOpen = false;
            this.micGateGainNode.gain.setTargetAtTime(0.0, this.audioContext.currentTime, 0.045);
          }
        }
      } else {
        this.currentGateOpen = true;
        if (this.micGateGainNode) {
          this.micGateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
        }
      }

      if (this.levelListeners.length > 0) {
        const payload = {
          level: normalized,
          isGateOpen: this.currentGateOpen,
          db: currentDb,
        };
        this.levelListeners.forEach(fn => fn(payload));
      }
    };

    this.levelIntervalId = window.setInterval(update, 25);
  }

  private closeAudioContextOnly(): void {
    const nodes: Array<AudioNode | null> = [
      this.micSourceNode,
      this.micHighPassNode,
      this.micHighShelfNode,
      this.micCompressorNode,
      this.micGateWorkletNode,
      this.micGateGainNode,
      this.micAnalyser,
      this.micGainNode,
      this.destinationNode,
    ];
    nodes.forEach(node => {
      if (!node) return;
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    });

    if (this.micGateWorkletNode) {
      this.micGateWorkletNode.port.onmessage = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.onstatechange = null;
      try {
        void this.audioContext.close();
      } catch {
        // ignore
      }
    }
    this.audioContext = null;
    this.micSourceNode = null;
    this.micGainNode = null;
    this.micGateGainNode = null;
    this.micGateWorkletNode = null;
    this.destinationNode = null;
    this.micAnalyser = null;
    this.micHighPassNode = null;
    this.micHighShelfNode = null;
    this.micCompressorNode = null;
  }

  public cleanup(): void {
    if (this.levelIntervalId !== null) {
      clearInterval(this.levelIntervalId);
      this.levelIntervalId = null;
    }
    this.liveGameTrackAvailable = false;
    this.closeAudioContextOnly();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.levelListeners.length > 0) {
      this.levelListeners.forEach(fn => fn({ level: 0, isGateOpen: true, db: -80 }));
    }
    if (this.gameLevelListeners.length > 0) {
      this.gameLevelListeners.forEach(fn => fn({ level: 0, db: -80 }));
    }
  }
}

export const audioMixer = new AudioMixerService();
