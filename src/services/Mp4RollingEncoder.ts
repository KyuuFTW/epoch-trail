import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { audioMixer } from './AudioMixer';

interface StoredVideoChunk {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration: number;
  data: Uint8Array;
}

interface StoredAudioChunk {
  type: EncodedAudioChunkType;
  timestamp: number;
  duration: number;
  data: Uint8Array;
}

interface TrackProcessor<T> {
  readable: ReadableStream<T>;
}

type TrackProcessorConstructor = new <T>(options: {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}) => TrackProcessor<T>;

export interface Mp4Snapshot {
  blob: Blob;
  durationSeconds: number;
  frameRate: number;
  width: number;
  height: number;
  droppedFrames: number;
}

function copyChunk(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}

function copyDescription(description?: AllowSharedBufferSource): ArrayBuffer | undefined {
  if (!description) return undefined;
  const source = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  return source.slice().buffer;
}

function containsH264IdrFrame(data: Uint8Array): boolean {
  // WebCodecs emits AVC samples as four-byte length-prefixed NAL units when
  // `avc.format` is `avc`. A few Windows drivers have reported an IDR sample
  // as a delta chunk, so verify the bitstream before rejecting it.
  let offset = 0;
  let parsedAvcSample = false;
  while (offset + 4 <= data.byteLength) {
    const length = (
      data[offset] * 0x1000000
      + (data[offset + 1] << 16)
      + (data[offset + 2] << 8)
      + data[offset + 3]
    ) >>> 0;
    if (length === 0 || offset + 4 + length > data.byteLength) break;
    parsedAvcSample = true;
    if ((data[offset + 4] & 0x1f) === 5) return true;
    offset += 4 + length;
  }
  if (parsedAvcSample && offset === data.byteLength) return false;

  // Be defensive if a driver ignores the requested AVC output format and
  // returns Annex-B start codes instead.
  for (let index = 0; index + 4 < data.byteLength; index++) {
    const threeByteStart = data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1;
    const fourByteStart = data[index] === 0 && data[index + 1] === 0
      && data[index + 2] === 0 && data[index + 3] === 1;
    if (!threeByteStart && !fourByteStart) continue;
    const nalOffset = index + (fourByteStart ? 4 : 3);
    if (nalOffset < data.byteLength && (data[nalOffset] & 0x1f) === 5) return true;
  }
  return false;
}

function normalizeFrameRate(value: number | undefined, fallback = 60): number {
  const candidate = Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : fallback;
  return Math.max(1, Math.min(240, Math.round(candidate)));
}

/**
 * Keeps encoded H.264/AAC chunks in a timestamped ring and muxes a fresh,
 * seekable MP4 when a clip is requested. Unlike MediaRecorder timeslices,
 * every retained window starts on a known video keyframe.
 */
export class Mp4RollingEncoder {
  private readonly maxDurationUs: number;
  private readonly requestedFrameRate: number;

  private videoEncoder: VideoEncoder | null = null;
  private audioEncoder: AudioEncoder | null = null;
  private videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private audioReader: ReadableStreamDefaultReader<AudioData> | null = null;

  private videoChunks: StoredVideoChunk[] = [];
  private audioChunks: StoredAudioChunk[] = [];
  private videoDecoderConfig: VideoDecoderConfig | null = null;
  private audioDecoderConfig: AudioDecoderConfig | null = null;

  private running = false;
  private paused = false;
  private lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
  private droppedFrames = 0;
  private width = 0;
  private height = 0;
  private configuredFrameRate = 60;
  private configuredAudioSampleRate = 48_000;
  private configuredAudioChannels = 2;
  private configuredAudioCodec: 'aac' | 'opus' = 'aac';
  private videoReadTask: Promise<void> | null = null;
  private audioReadTask: Promise<void> | null = null;
  private startupReadyPromise: Promise<void> | null = null;
  private resolveStartupReady: (() => void) | null = null;
  private rejectStartupReady: ((error: Error) => void) | null = null;
  private encoderError: Error | null = null;
  private streamTimestampOrigin: number | null = null;
  private lastVideoChunkAt = 0;

  constructor(durationSeconds: number, requestedFrameRate: number) {
    this.maxDurationUs = Math.max(1, durationSeconds) * 1_000_000;
    this.requestedFrameRate = normalizeFrameRate(requestedFrameRate);
  }

  public static isAvailable(): boolean {
    return Boolean(
      (globalThis as any).MediaStreamTrackProcessor &&
      globalThis.VideoEncoder &&
      globalThis.EncodedVideoChunk,
    );
  }

  public async start(videoTrack: MediaStreamTrack, audioTrack?: MediaStreamTrack | null): Promise<void> {
    if (!Mp4RollingEncoder.isAvailable()) {
      throw new Error('WebCodecs or MediaStreamTrackProcessor is unavailable.');
    }

    const settings = videoTrack.getSettings();
    this.width = Math.max(2, Math.floor((settings.width || 1920) / 2) * 2);
    this.height = Math.max(2, Math.floor((settings.height || 1080) / 2) * 2);
    this.configuredFrameRate = normalizeFrameRate(settings.frameRate, this.requestedFrameRate);

    const videoConfigs = await this.selectVideoConfigs();

    const Processor = (globalThis as any).MediaStreamTrackProcessor as TrackProcessorConstructor;
    const videoProcessor = new Processor<VideoFrame>({ track: videoTrack, maxBufferSize: 2 });
    this.videoReader = videoProcessor.readable.getReader();

    this.running = true;
    this.videoReadTask = this.readVideoFrames();

    // Start AAC alongside the video processor. Starting it only after H.264
    // warm-up could shift audio by several seconds when an encoder profile had
    // to fall back.
    if (audioTrack && globalThis.AudioEncoder && globalThis.EncodedAudioChunk) {
      await this.tryStartAudio(audioTrack, Processor);
    }

    // Do not tell the UI that the buffer is active until Windows has actually
    // produced a muxable IDR frame and AVC decoder configuration. Some GPU
    // drivers accept one H.264 profile and then fail asynchronously, so retry
    // the other supported profiles before giving up.
    let startupFailure: Error | null = null;
    for (const videoConfig of videoConfigs) {
      this.resetVideoAttempt();
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (this.videoEncoder === encoder) this.handleVideoChunk(chunk, metadata);
        },
        error: error => {
          console.error('MP4 video encoder error:', error);
          if (this.videoEncoder === encoder) this.signalEncoderFailure(error);
        },
      });
      this.videoEncoder = encoder;

      try {
        encoder.configure(videoConfig);
        await this.waitForStartupReady(2_500);
        startupFailure = null;
        break;
      } catch (error) {
        startupFailure = error instanceof Error ? error : new Error(String(error));
        if (encoder.state !== 'closed') encoder.close();
        if (this.videoEncoder === encoder) this.videoEncoder = null;
      }
    }
    if (startupFailure || !this.hasUsableKeyframe()) {
      throw startupFailure || new Error('No supported Windows H.264 encoder produced a usable keyframe.');
    }

  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Resuming must never discard the rolling history. Request a fresh IDR so
    // the next snapshot can choose a recent, independently decodable boundary.
    this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
  }

  public async snapshot(): Promise<Mp4Snapshot> {
    if (!this.videoEncoder || this.videoEncoder.state !== 'configured') {
      throw this.encoderError || new Error('The H.264 encoder is not running.');
    }

    // flush() must happen before inspecting the ring: hardware encoders can
    // retain several seconds of output internally even though input is live.
    await this.videoEncoder.flush();
    if (this.audioEncoder?.state === 'configured') {
      await this.audioEncoder.flush();
    }

    if (!this.hasUsableKeyframe()) {
      // This is most often reached immediately after leaving review, when the
      // ring intentionally starts a fresh timestamp epoch. Force the next
      // input to be an IDR and allow the live track a brief recovery window.
      this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
      await this.waitForUsableKeyframe(2_000);
      await this.videoEncoder.flush();
    }

    if (this.videoChunks.length === 0) {
      throw this.encoderError || new Error('The selected source has not produced any encoded video frames.');
    }
    if (!this.videoDecoderConfig?.description) {
      throw new Error('The Windows H.264 encoder did not provide an AVC decoder configuration.');
    }
    if (performance.now() - this.lastVideoChunkAt > 3_000) {
      throw new Error('The selected source has stopped producing current video frames.');
    }

    let chunks = [...this.videoChunks];
    let newestTimestamp = chunks[chunks.length - 1].timestamp;
    let desiredStart = newestTimestamp - this.maxDurationUs;
    let startIndex = chunks.findIndex(chunk => chunk.type === 'key' && chunk.timestamp >= desiredStart);

    // Never fall back directly to the oldest keyframe. If the encoder missed
    // its periodic IDRs, request one now so the clip still ends at "now" and
    // remains bounded by the configured rolling duration.
    if (startIndex < 0 && this.running && !this.paused) {
      const previousNewestTimestamp = newestTimestamp;
      this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
      await this.waitForKeyframeAfter(previousNewestTimestamp, 2_000);
      await this.videoEncoder.flush();
      if (this.audioEncoder?.state === 'configured') await this.audioEncoder.flush();

      chunks = [...this.videoChunks];
      newestTimestamp = chunks[chunks.length - 1].timestamp;
      desiredStart = newestTimestamp - this.maxDurationUs;
      startIndex = chunks.findIndex(chunk => chunk.type === 'key' && chunk.timestamp >= desiredStart);
    }

    if (startIndex < 0) {
      for (let index = chunks.length - 1; index >= 0; index--) {
        if (chunks[index].type === 'key') {
          startIndex = index;
          break;
        }
      }
    }
    if (startIndex < 0) {
      throw new Error('The Windows H.264 encoder did not produce a usable keyframe.');
    }
    if (newestTimestamp - chunks[startIndex].timestamp > this.maxDurationUs + 2_000_000) {
      throw new Error('The H.264 encoder could not produce a recent keyframe for the rolling window.');
    }

    const videoChunks = chunks.slice(startIndex);
    const startTimestamp = videoChunks[0].timestamp;
    const outputFrameRate = normalizeFrameRate(this.configuredFrameRate, this.requestedFrameRate);
    const lastVideoChunk = videoChunks[videoChunks.length - 1];
    const endTimestamp = lastVideoChunk.timestamp + (lastVideoChunk.duration || Math.round(1_000_000 / outputFrameRate));
    
    // Select all audio chunks that overlap with the active clip window
    const audioChunks = this.audioChunks.filter(chunk => 
      (chunk.timestamp + (chunk.duration || 0)) >= startTimestamp && chunk.timestamp <= (endTimestamp + 500_000)
    );
    const measuredDurationUs = Math.max(
      ...videoChunks.map(chunk => chunk.timestamp + (chunk.duration || 0)),
      ...audioChunks.map(chunk => chunk.timestamp + (chunk.duration || 0)),
    ) - startTimestamp;
    const durationSeconds = Math.max(0.001, measuredDurationUs / 1_000_000);

    const audioSampleRate = this.audioDecoderConfig?.sampleRate || this.configuredAudioSampleRate || 48_000;
    const audioChannels = this.audioDecoderConfig?.numberOfChannels || this.configuredAudioChannels || 2;
    const hasAudio = audioChunks.length > 0;

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: this.width,
        height: this.height,
        frameRate: outputFrameRate,
      },
      ...(hasAudio
        ? {
            audio: {
              codec: this.configuredAudioCodec,
              numberOfChannels: audioChannels,
              sampleRate: audioSampleRate,
            },
          }
        : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'cross-track-offset',
    });

    videoChunks.forEach((chunk, index) => {
      const metadata = index === 0 && this.videoDecoderConfig
        ? {
            decoderConfig: {
              ...this.videoDecoderConfig,
              description: copyDescription(this.videoDecoderConfig.description),
            },
          }
        : undefined;
      muxer.addVideoChunkRaw(
        chunk.data,
        chunk.type,
        chunk.timestamp - startTimestamp,
        chunk.duration,
        metadata,
      );
    });

    if (hasAudio) {
      audioChunks.forEach((chunk, index) => {
        const metadata = index === 0 && this.audioDecoderConfig
          ? {
              decoderConfig: {
                ...this.audioDecoderConfig,
                description: copyDescription(this.audioDecoderConfig.description),
              },
            }
          : undefined;
        const relativeTime = Math.max(0, chunk.timestamp - startTimestamp);
        muxer.addAudioChunkRaw(
          chunk.data,
          chunk.type,
          relativeTime,
          chunk.duration,
          metadata,
        );
      });
    }

    muxer.finalize();

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      durationSeconds,
      frameRate: outputFrameRate,
      width: this.width,
      height: this.height,
      droppedFrames: this.droppedFrames,
    };
  }

  public stop(): void {
    this.running = false;
    void this.videoReader?.cancel().catch(() => undefined);
    void this.audioReader?.cancel().catch(() => undefined);
    this.videoReader = null;
    this.audioReader = null;

    if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
      this.videoEncoder.close();
    }
    if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
      this.audioEncoder.close();
    }
    this.videoEncoder = null;
    this.audioEncoder = null;
    this.videoChunks = [];
    this.audioChunks = [];
    this.videoDecoderConfig = null;
    this.audioDecoderConfig = null;
    this.videoReadTask = null;
    this.audioReadTask = null;
    this.streamTimestampOrigin = null;
    this.lastVideoChunkAt = 0;
    this.resolveStartupReady = null;
    this.rejectStartupReady = null;
    this.startupReadyPromise = null;
  }

  public getDroppedFrames(): number {
    return this.droppedFrames;
  }

  public getLastError(): string | null {
    return this.encoderError?.message || null;
  }

  public getBufferMetrics(): { durationSeconds: number; chunkCount: number; bytes: number } {
    if (this.videoChunks.length === 0) {
      return { durationSeconds: 0, chunkCount: 0, bytes: 0 };
    }
    const firstTimestamp = this.videoChunks[0].timestamp;
    const lastChunk = this.videoChunks[this.videoChunks.length - 1];
    const durationSeconds = Math.max(0, lastChunk.timestamp + lastChunk.duration - firstTimestamp) / 1_000_000;
    const bytes = this.videoChunks.reduce((total, chunk) => total + chunk.data.byteLength, 0)
      + this.audioChunks.reduce((total, chunk) => total + chunk.data.byteLength, 0);
    return { durationSeconds, chunkCount: this.videoChunks.length, bytes };
  }

  private async selectVideoConfigs(): Promise<VideoEncoderConfig[]> {
    const pixelsPerSecond = this.width * this.height * this.configuredFrameRate;
    const bitrate = Math.round(Math.max(6_000_000, Math.min(50_000_000, pixelsPerSecond * 0.1)));
    const level = pixelsPerSecond > 2560 * 1440 * 60 ? '34' : pixelsPerSecond > 1920 * 1080 * 60 ? '33' : '2A';
    const codecs = [`avc1.6400${level}`, `avc1.4D00${level}`, `avc1.4200${level}`];
    const accelerationPreferences: HardwareAcceleration[] = ['prefer-hardware', 'no-preference'];
    const supportedConfigs: VideoEncoderConfig[] = [];

    for (const hardwareAcceleration of accelerationPreferences) {
      for (const codec of codecs) {
        const config: VideoEncoderConfig = {
          codec,
          width: this.width,
          height: this.height,
          framerate: this.configuredFrameRate,
          bitrate,
          hardwareAcceleration,
          latencyMode: 'realtime',
          avc: { format: 'avc' },
        };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) supportedConfigs.push(support.config || config);
        } catch {
          // Try the next H.264 profile or acceleration preference.
        }
      }
    }

    if (supportedConfigs.length === 0) {
      throw new Error(`H.264 encoding is unavailable for ${this.width}x${this.height}@${this.configuredFrameRate}.`);
    }
    return supportedConfigs;
  }

  private async tryStartAudio(
    audioTrack: MediaStreamTrack,
    Processor: TrackProcessorConstructor,
  ): Promise<void> {
    try {
      const settings = audioTrack.getSettings();
      const trackSampleRate = settings.sampleRate || 48_000;
      const trackChannels = Math.min(2, Math.max(1, settings.channelCount || 2));

      const targetBitrate = audioMixer.getConfig().audioBitrate || 256_000;
      const aacBitrates = Array.from(new Set([targetBitrate, 384_000, 320_000, 256_000, 192_000, 128_000, 96_000]));
      const opusBitrates = Array.from(new Set([Math.min(targetBitrate, 256_000), 192_000, 128_000, 96_000, 64_000]));

      const ratesToTest = Array.from(new Set([trackSampleRate, 48_000, 44_100])).filter(r => r > 0);
      const channelsToTest = Array.from(new Set([trackChannels, 2, 1]));

      let chosenConfig: AudioEncoderConfig | null = null;
      let chosenCodec: 'aac' | 'opus' = 'aac';

      // 1. Try AAC-LC first with high bitrate options
      for (const rate of ratesToTest) {
        for (const ch of channelsToTest) {
          for (const bitrate of aacBitrates) {
            const candidate: AudioEncoderConfig = {
              codec: 'mp4a.40.2',
              sampleRate: rate,
              numberOfChannels: ch,
              bitrate,
            };
            try {
              const support = await AudioEncoder.isConfigSupported(candidate);
              if (support.supported) {
                chosenConfig = support.config || candidate;
                chosenCodec = 'aac';
                break;
              }
            } catch {}
          }
          if (chosenConfig) break;
        }
        if (chosenConfig) break;
      }

      // 2. If AAC is not supported, fall back to Opus
      if (!chosenConfig) {
        for (const rate of ratesToTest) {
          for (const ch of channelsToTest) {
            for (const bitrate of opusBitrates) {
              const candidate: AudioEncoderConfig = {
                codec: 'opus',
                sampleRate: rate,
                numberOfChannels: ch,
                bitrate,
              };
              try {
                const support = await AudioEncoder.isConfigSupported(candidate);
                if (support.supported) {
                  chosenConfig = support.config || candidate;
                  chosenCodec = 'opus';
                  break;
                }
              } catch {}
            }
            if (chosenConfig) break;
          }
          if (chosenConfig) break;
        }
      }

      if (!chosenConfig) {
        console.warn('Neither AAC nor Opus audio encoding is supported on this platform; MP4 clips will be video-only.');
        return;
      }

      this.configuredAudioCodec = chosenCodec;
      this.configuredAudioSampleRate = chosenConfig.sampleRate;
      this.configuredAudioChannels = chosenConfig.numberOfChannels;

      this.audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => this.handleAudioChunk(chunk, metadata),
        error: error => {
          console.error('MP4 audio encoder error:', error instanceof Error ? error.message : String(error));
        },
      });
      this.audioEncoder.configure(chosenConfig);

      const audioProcessor = new Processor<AudioData>({ track: audioTrack, maxBufferSize: 16 });
      this.audioReader = audioProcessor.readable.getReader();
      this.audioReadTask = this.readAudioFrames();
      console.log(`[Mp4RollingEncoder] Audio pipeline initialized: ${chosenCodec} @ ${this.configuredAudioSampleRate}Hz, ${this.configuredAudioChannels}ch`);
    } catch (error) {
      console.warn('Unable to initialize audio capture; MP4 clips will be video-only:', error);
      if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
        this.audioEncoder.close();
      }
      this.audioEncoder = null;
      this.audioReader = null;
    }
  }

  private async readVideoFrames(): Promise<void> {
    try {
      while (this.running && this.videoReader) {
        const { value: frame, done } = await this.videoReader.read();
        if (done || !frame) break;

        try {
          if (this.paused || !this.videoEncoder || this.videoEncoder.state !== 'configured') continue;
          if (this.videoEncoder.encodeQueueSize > 8) {
            this.droppedFrames++;
            continue;
          }

          const timestamp = frame.timestamp;
          const keyFrame = !Number.isFinite(this.lastKeyframeTimestamp)
            || timestamp - this.lastKeyframeTimestamp >= 1_000_000;
          this.videoEncoder.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
      }
    } catch (error) {
      if (this.running) this.signalEncoderFailure(error);
    }
  }

  private async readAudioFrames(): Promise<void> {
    while (this.running && this.audioReader) {
      const { value: audioData, done } = await this.audioReader.read();
      if (done || !audioData) break;
      try {
        if (this.paused) continue;

        if (
          !this.audioEncoder ||
          this.audioEncoder.state !== 'configured' ||
          this.configuredAudioSampleRate !== audioData.sampleRate ||
          this.configuredAudioChannels !== audioData.numberOfChannels
        ) {
          try {
            const frameSampleRate = audioData.sampleRate;
            const frameChannels = Math.min(2, Math.max(1, audioData.numberOfChannels));
            let chosenConfig: AudioEncoderConfig | null = null;
            let chosenCodec: 'aac' | 'opus' = this.configuredAudioCodec;

            const targetBitrate = audioMixer.getConfig().audioBitrate || 256_000;
            const aacBitrates = Array.from(new Set([targetBitrate, 384_000, 320_000, 256_000, 192_000, 128_000, 96_000]));
            const opusBitrates = Array.from(new Set([Math.min(targetBitrate, 256_000), 192_000, 128_000, 96_000, 64_000]));

            const codecsToTry = this.configuredAudioCodec === 'aac'
              ? [
                  { codec: 'mp4a.40.2' as const, rate: frameSampleRate, bitrates: aacBitrates },
                  { codec: 'opus' as const, rate: frameSampleRate, bitrates: opusBitrates },
                ]
              : [
                  { codec: 'opus' as const, rate: frameSampleRate, bitrates: opusBitrates },
                  { codec: 'mp4a.40.2' as const, rate: frameSampleRate, bitrates: aacBitrates },
                ];

            for (const { codec, rate, bitrates } of codecsToTry) {
              for (const bitrate of bitrates) {
                const candidate: AudioEncoderConfig = {
                  codec,
                  sampleRate: rate,
                  numberOfChannels: frameChannels,
                  bitrate,
                };
                const support = await AudioEncoder.isConfigSupported(candidate);
                if (support.supported) {
                  chosenConfig = support.config || candidate;
                  chosenCodec = codec === 'opus' ? 'opus' : 'aac';
                  break;
                }
              }
              if (chosenConfig) break;
            }

            if (chosenConfig) {
              if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
                try { this.audioEncoder.close(); } catch {}
              }
              this.audioEncoder = new AudioEncoder({
                output: (chunk, metadata) => this.handleAudioChunk(chunk, metadata),
                error: error => {
                  console.error('MP4 audio encoder error:', error instanceof Error ? error.message : String(error));
                },
              });
              this.audioEncoder.configure(chosenConfig);
              this.configuredAudioCodec = chosenCodec;
              this.configuredAudioSampleRate = frameSampleRate;
              this.configuredAudioChannels = frameChannels;
              console.log(`[Mp4RollingEncoder] Audio encoder dynamically reconfigured: ${chosenCodec} @ ${frameSampleRate}Hz, ${frameChannels}ch`);
            }
          } catch (cfgErr) {
            console.warn('AudioEncoder dynamic reconfiguration failed:', cfgErr);
          }
        }

        if (this.audioEncoder && this.audioEncoder.state === 'configured') {
          this.audioEncoder.encode(audioData);
        }
      } catch (encodeErr) {
        console.warn('Failed to encode audio frame:', encodeErr);
      } finally {
        audioData.close();
      }
    }
  }

  private handleVideoChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    if (metadata?.decoderConfig) {
      this.videoDecoderConfig = {
        ...metadata.decoderConfig,
        description: copyDescription(metadata.decoderConfig.description),
      };
    }
    const data = copyChunk(chunk);
    const type: EncodedVideoChunkType = chunk.type === 'key' || containsH264IdrFrame(data)
      ? 'key'
      : 'delta';
    if (this.streamTimestampOrigin === null) this.streamTimestampOrigin = chunk.timestamp;
    const normalizedTimestamp = Math.max(0, chunk.timestamp - this.streamTimestampOrigin);
    this.videoChunks.push({
      type,
      timestamp: normalizedTimestamp,
      duration: chunk.duration || Math.round(1_000_000 / this.configuredFrameRate),
      data,
    });
    this.lastVideoChunkAt = performance.now();
    if (type === 'key') this.lastKeyframeTimestamp = chunk.timestamp;
    this.pruneRing();

    if (this.hasUsableKeyframe()) {
      this.resolveStartupReady?.();
      this.resolveStartupReady = null;
      this.rejectStartupReady = null;
    }
  }

  private hasUsableKeyframe(): boolean {
    return Boolean(
      this.videoDecoderConfig?.description
      && this.videoChunks.some(chunk => chunk.type === 'key'),
    );
  }

  private async waitForStartupReady(timeoutMs: number): Promise<void> {
    if (this.hasUsableKeyframe()) return;
    if (!this.startupReadyPromise) throw new Error('The H.264 encoder did not initialize.');

    let timeoutId = 0;
    try {
      await Promise.race([
        this.startupReadyPromise,
        new Promise<never>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(this.encoderError || new Error('Timed out waiting for the first H.264 keyframe.'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  private async waitForUsableKeyframe(timeoutMs: number): Promise<void> {
    const startedAt = performance.now();
    while (!this.hasUsableKeyframe()) {
      if (this.encoderError) throw this.encoderError;
      if (!this.running || this.paused) break;
      if (performance.now() - startedAt >= timeoutMs) break;
      await new Promise<void>(resolve => window.setTimeout(resolve, 40));
    }
  }

  private async waitForKeyframeAfter(timestamp: number, timeoutMs: number): Promise<void> {
    const startedAt = performance.now();
    while (!this.videoChunks.some(chunk => chunk.type === 'key' && chunk.timestamp > timestamp)) {
      if (this.encoderError) throw this.encoderError;
      if (!this.running || this.paused) break;
      if (performance.now() - startedAt >= timeoutMs) break;
      await new Promise<void>(resolve => window.setTimeout(resolve, 40));
    }
  }

  private signalEncoderFailure(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.encoderError = normalized;
    this.rejectStartupReady?.(normalized);
    this.resolveStartupReady = null;
    this.rejectStartupReady = null;
  }

  private resetVideoAttempt(): void {
    this.videoChunks = [];
    this.videoDecoderConfig = null;
    this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
    this.encoderError = null;
    this.startupReadyPromise = new Promise<void>((resolve, reject) => {
      this.resolveStartupReady = resolve;
      this.rejectStartupReady = reject;
    });
  }

  private handleAudioChunk(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void {
    if (metadata?.decoderConfig) {
      this.audioDecoderConfig = {
        ...metadata.decoderConfig,
        description: copyDescription(metadata.decoderConfig.description),
      };
    }
    if (this.streamTimestampOrigin === null) this.streamTimestampOrigin = chunk.timestamp;
    this.audioChunks.push({
      type: chunk.type,
      timestamp: Math.max(0, chunk.timestamp - this.streamTimestampOrigin),
      duration: chunk.duration || 0,
      data: copyChunk(chunk),
    });
    if (this.audioChunks.length === 1) {
      console.log(`[Mp4RollingEncoder] Successfully encoded first audio chunk: codec=${this.configuredAudioCodec}, size=${chunk.byteLength}B, timestamp=${chunk.timestamp}`);
    }
  }

  private pruneRing(): void {
    if (this.videoChunks.length < 2) return;
    const newestTimestamp = this.videoChunks[this.videoChunks.length - 1].timestamp;
    const cutoff = newestTimestamp - this.maxDurationUs - 1_000_000;
    if (cutoff <= this.videoChunks[0].timestamp) return;

    let keepIndex = 0;
    for (let index = 0; index < this.videoChunks.length; index++) {
      const chunk = this.videoChunks[index];
      if (chunk.type === 'key' && chunk.timestamp <= cutoff) {
        keepIndex = index;
      }
      if (chunk.timestamp > cutoff) break;
    }

    if (keepIndex === 0 && this.videoChunks[0].timestamp < cutoff) {
      const newerKeyIndex = this.videoChunks.findIndex((chunk, index) => (
        index > 0 && chunk.type === 'key' && chunk.timestamp > cutoff
      ));
      if (newerKeyIndex > 0) keepIndex = newerKeyIndex;
    }

    if (keepIndex > 0) {
      const keepTimestamp = this.videoChunks[keepIndex].timestamp;
      this.videoChunks.splice(0, keepIndex);
      const audioKeepIndex = this.audioChunks.findIndex(chunk => (chunk.timestamp + (chunk.duration || 0)) >= keepTimestamp);
      if (audioKeepIndex > 0) {
        this.audioChunks.splice(0, audioKeepIndex);
      }
    }
  }
}
