import { AudioConfig, AudioDevice } from '../types';

export class AudioMixerService {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private gameGainNode: GainNode | null = null;
  private micGainNode: GainNode | null = null;
  private micGateGainNode: GainNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micHighPassNode: BiquadFilterNode | null = null;
  private micHighShelfNode: BiquadFilterNode | null = null;
  private micCompressorNode: DynamicsCompressorNode | null = null;
  private animFrameId: number | null = null;
  private levelListeners: ((data: { level: number; isGateOpen: boolean; db: number }) => void)[] = [];

  private lastSpeechTime = 0;
  private currentGateOpen = true;

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

  public async initAudioMixer(
    gameAudioTrack?: MediaStreamTrack | null,
    audioConfig?: Partial<AudioConfig>
  ): Promise<MediaStreamTrack | null> {
    try {
      this.cleanup();

      if (audioConfig) {
        this.config = { ...this.config, ...audioConfig };
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;

      const targetSampleRate = this.config.audioSampleRate || 48_000;
      try {
        this.audioContext = new AudioContextClass({ sampleRate: targetSampleRate });
      } catch {
        this.audioContext = new AudioContextClass();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      if (this.audioContext.state !== 'running') {
        console.warn('Web Audio mixer is not running; using the desktop audio track directly.');
        this.cleanup();
        return gameAudioTrack || null;
      }

      this.destinationNode = this.audioContext.createMediaStreamDestination();
      let hasAnyAudioInput = false;

      // 1. Hook up Game Audio if available (uncompressed, full dynamic range)
      if (gameAudioTrack && gameAudioTrack.kind === 'audio' && gameAudioTrack.readyState === 'live') {
        const gameStream = new MediaStream([gameAudioTrack]);
        const gameSource = this.audioContext.createMediaStreamSource(gameStream);
        this.gameGainNode = this.audioContext.createGain();
        this.gameGainNode.gain.value = this.config.isGameAudioMuted ? 0 : this.config.gameVolume;
        gameSource.connect(this.gameGainNode);
        this.gameGainNode.connect(this.destinationNode);
        if (!this.config.isGameAudioMuted) {
          hasAnyAudioInput = true;
        }
      }

      // 2. Hook up Microphone with Multi-Stage Anti-Static & Noise Gate DSP
      if (!this.config.isMicMuted) try {
        const useAiNoiseSuppression = this.config.micNoiseSuppression && !this.config.bypassAudioFilters;
        const micConstraints: MediaTrackConstraints = {
          echoCancellation: useAiNoiseSuppression,
          noiseSuppression: useAiNoiseSuppression,
          autoGainControl: false, // Prevents AGC from artificially amplifying background hiss
          channelCount: 2,
        };
        if (this.config.micDeviceId && this.config.micDeviceId !== 'default') {
          micConstraints.deviceId = { exact: this.config.micDeviceId };
        }

        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: micConstraints,
          video: false,
        });

        if (this.micStream && this.micStream.getAudioTracks().length > 0) {
          const micTrack = this.micStream.getAudioTracks()[0];
          if (micTrack.readyState === 'live') {
            const micSource = this.audioContext.createMediaStreamSource(this.micStream);

            // Master mic volume gain node
            this.micGainNode = this.audioContext.createGain();
            this.micGainNode.gain.value = this.config.micVolume;

            // Noise gate dynamic envelope node
            this.micGateGainNode = this.audioContext.createGain();
            this.micGateGainNode.gain.value = 1.0;
            this.currentGateOpen = true;
            this.lastSpeechTime = performance.now();

            // Real-time mic analyzer for level meter and noise gate detection
            this.micAnalyser = this.audioContext.createAnalyser();
            this.micAnalyser.fftSize = 256;
            this.micAnalyser.smoothingTimeConstant = 0.2;

            let lastNode: AudioNode = micSource;

            // Anti-Static & Hum Removal Filters
            if (this.config.antiStaticFilter && !this.config.bypassAudioFilters) {
              // 1. High-pass filter at 85Hz: Cuts 50/60Hz AC electrical hum & fan rumble
              this.micHighPassNode = this.audioContext.createBiquadFilter();
              this.micHighPassNode.type = 'highpass';
              this.micHighPassNode.frequency.value = 85;
              this.micHighPassNode.Q.value = 0.707;

              // 2. High-shelf filter at 13.5kHz: Soft roll-off (-3.5dB) to tame high-frequency USB preamp hiss
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

              lastNode.connect(this.micHighPassNode);
              this.micHighPassNode.connect(this.micHighShelfNode);
              this.micHighShelfNode.connect(this.micCompressorNode);
              lastNode = this.micCompressorNode;
            }

            // Connect Noise Gate Gain
            lastNode.connect(this.micGateGainNode);
            this.micGateGainNode.connect(this.micGainNode);
            this.micGainNode.connect(this.micAnalyser);
            this.micGainNode.connect(this.destinationNode);

            this.startLevelMonitoring();
            hasAnyAudioInput = true;
          }
        }
      } catch (micErr) {
        console.warn('Microphone permission not granted or device busy:', micErr);
      }

      if (!hasAnyAudioInput) {
        return gameAudioTrack || null;
      }

      const mixedTracks = this.destinationNode.stream.getAudioTracks();
      return mixedTracks.length > 0 ? mixedTracks[0] : (gameAudioTrack || null);
    } catch (err) {
      console.error('Failed to initialize AudioMixer:', err);
      return null;
    }
  }

  public setGameVolume(volume: number): void {
    this.config.gameVolume = Math.max(0, Math.min(1, volume));
    if (this.gameGainNode && this.audioContext) {
      this.gameGainNode.gain.setValueAtTime(this.config.gameVolume, this.audioContext.currentTime);
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
  }

  public setMicNoiseSuppression(enabled: boolean): void {
    this.config.micNoiseSuppression = enabled;
  }

  public setNoiseGateEnabled(enabled: boolean): void {
    this.config.noiseGateEnabled = enabled;
    if (!enabled && this.micGateGainNode && this.audioContext) {
      this.micGateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
    }
  }

  public setNoiseGateThreshold(thresholdDb: number): void {
    this.config.noiseGateThresholdDb = thresholdDb;
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

  private startLevelMonitoring(): void {
    if (!this.micAnalyser) return;
    const timeDomainData = new Uint8Array(this.micAnalyser.fftSize);

    const update = () => {
      if (this.micAnalyser && this.levelListeners.length > 0 && this.audioContext) {
        this.micAnalyser.getByteTimeDomainData(timeDomainData);
        let sumSq = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          const sample = (timeDomainData[i] - 128) / 128;
          sumSq += sample * sample;
        }
        const rms = Math.sqrt(sumSq / timeDomainData.length);
        const currentDb = Math.max(-80, Math.round(20 * Math.log10(Math.max(rms, 0.0001))));
        const normalized = Math.min(1, Math.max(0, (currentDb + 60) / 60));

        // Noise Gate State Machine
        if (this.config.noiseGateEnabled && this.micGateGainNode) {
          const thresholdDb = this.config.noiseGateThresholdDb ?? -42;
          const now = performance.now();

          if (currentDb >= thresholdDb) {
            this.lastSpeechTime = now;
            if (!this.currentGateOpen) {
              this.currentGateOpen = true;
              // Smooth, fast attack (15ms)
              this.micGateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.015);
            }
          } else {
            // Hold gate open for 100ms after speech ends to prevent cutting off words
            const holdTimeMs = 100;
            if (now - this.lastSpeechTime > holdTimeMs && this.currentGateOpen) {
              this.currentGateOpen = false;
              // Smooth decay (35ms) to silence
              this.micGateGainNode.gain.setTargetAtTime(0.0, this.audioContext.currentTime, 0.035);
            }
          }
        } else {
          this.currentGateOpen = true;
        }

        const payload = {
          level: normalized,
          isGateOpen: this.currentGateOpen,
          db: currentDb,
        };
        this.levelListeners.forEach(fn => fn(payload));
      }
      this.animFrameId = requestAnimationFrame(update);
    };

    update();
  }

  public cleanup(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        // ignore
      }
      this.audioContext = null;
    }
    this.gameGainNode = null;
    this.micGainNode = null;
    this.micGateGainNode = null;
    this.destinationNode = null;
    this.micAnalyser = null;
    this.micHighPassNode = null;
    this.micHighShelfNode = null;
    this.micCompressorNode = null;
  }
}

export const audioMixer = new AudioMixerService();
