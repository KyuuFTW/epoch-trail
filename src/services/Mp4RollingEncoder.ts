import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { audioMixer, SeparatedAudioTracks } from './AudioMixer';

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
  gameAudioBlob?: Blob;
  micAudioBlob?: Blob;
  durationSeconds: number;
  frameRate: number;
  width: number;
  height: number;
  droppedFrames: number;
}

interface SeparatedTrackRing {
  kind: 'game' | 'mic';
  reader: ReadableStreamDefaultReader<AudioData> | null;
  readTask: Promise<void> | null;
  encoder: AudioEncoder | null;
  chunks: StoredAudioChunk[];
  decoderConfig: AudioDecoderConfig | null;
  codec: 'aac' | 'opus';
  sampleRate: number;
  channels: number;
  inputOriginUs: number | null;
  baseOffsetUs: number;
  lastChunkTimestamp: number | null;
  lastChunkDuration: number;
}

function createSeparatedTrackRing(kind: 'game' | 'mic'): SeparatedTrackRing {
  return {
    kind,
    reader: null,
    readTask: null,
    encoder: null,
    chunks: [],
    decoderConfig: null,
    codec: 'aac',
    sampleRate: 48_000,
    channels: 2,
    inputOriginUs: null,
    baseOffsetUs: 0,
    lastChunkTimestamp: null,
    lastChunkDuration: 0,
  };
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

function clampAudioSample(value: number): number {
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

function softLimitAudio(value: number): number {
  if (value >= -0.9 && value <= 0.9) return value;
  const sign = value < 0 ? -1 : 1;
  const excess = Math.abs(value) - 0.9;
  return sign * (0.9 + 0.1 * Math.tanh(excess / 0.1));
}

function convertAudioDataForEncoder(
  audioData: AudioData,
  targetSampleRate: number,
  targetChannels: number,
  gain = 1.0,
): AudioData {
  const srcChannels = audioData.numberOfChannels;
  const srcFrames = audioData.numberOfFrames;
  const srcRate = audioData.sampleRate;

  const srcPlanes: Float32Array[] = [];
  for (let ch = 0; ch < srcChannels; ch++) {
    const plane = new Float32Array(srcFrames);
    audioData.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
    srcPlanes.push(plane);
  }

  const mappedPlanes: Float32Array[] = [];
  if (targetChannels === 1) {
    if (srcChannels === 1) {
      mappedPlanes.push(srcPlanes[0]);
    } else {
      const mono = new Float32Array(srcFrames);
      const scale = 1 / Math.min(srcChannels, 2);
      for (let i = 0; i < srcFrames; i++) {
        mono[i] = clampAudioSample((srcPlanes[0][i] + srcPlanes[1][i]) * scale);
      }
      mappedPlanes.push(mono);
    }
  } else {
    if (srcChannels === 1) {
      mappedPlanes.push(srcPlanes[0], srcPlanes[0]);
    } else if (srcChannels === 2) {
      mappedPlanes.push(srcPlanes[0], srcPlanes[1]);
    } else if (srcChannels >= 6) {
      const left = new Float32Array(srcFrames);
      const right = new Float32Array(srcFrames);
      const hasBack = srcChannels >= 8;
      for (let i = 0; i < srcFrames; i++) {
        const l = srcPlanes[0][i];
        const r = srcPlanes[1][i];
        const c = srcPlanes[2][i] * 0.7071;
        const ls = srcPlanes[4][i] * 0.7071;
        const rs = srcPlanes[5][i] * 0.7071;
        const lb = hasBack ? srcPlanes[6][i] * 0.5 : 0;
        const rb = hasBack ? srcPlanes[7][i] * 0.5 : 0;
        left[i] = clampAudioSample((l + c + ls + lb) * 0.75);
        right[i] = clampAudioSample((r + c + rs + rb) * 0.75);
      }
      mappedPlanes.push(left, right);
    } else {
      mappedPlanes.push(srcPlanes[0], srcPlanes[1]);
    }
  }

  const outFrames = srcRate === targetSampleRate
    ? srcFrames
    : Math.max(1, Math.round((srcFrames * targetSampleRate) / srcRate));
  const planarData = new Float32Array(outFrames * targetChannels);

  for (let ch = 0; ch < targetChannels; ch++) {
    const src = mappedPlanes[ch];
    const dstOffset = ch * outFrames;
    if (srcRate === targetSampleRate) {
      if (gain === 1.0) {
        planarData.set(src, dstOffset);
      } else {
        for (let i = 0; i < outFrames; i++) {
          planarData[dstOffset + i] = src[i] * gain;
        }
      }
    } else {
      const ratio = srcFrames / outFrames;
      for (let i = 0; i < outFrames; i++) {
        const srcPos = i * ratio;
        const idx0 = Math.floor(srcPos);
        const idx1 = Math.min(srcFrames - 1, idx0 + 1);
        const frac = srcPos - idx0;
        planarData[dstOffset + i] = (src[idx0] * (1 - frac) + src[idx1] * frac) * gain;
      }
    }
  }

  return new AudioData({
    format: 'f32-planar',
    sampleRate: targetSampleRate,
    numberOfChannels: targetChannels,
    numberOfFrames: outFrames,
    timestamp: audioData.timestamp,
    data: planarData,
  });
}

async function selectSupportedAudioConfig(
  preferredRate: number,
  preferredChannels: number,
  targetBitrate: number,
): Promise<{ config: AudioEncoderConfig; codec: 'aac' | 'opus' } | null> {
  const aacBitrates = Array.from(new Set([targetBitrate, 384_000, 320_000, 256_000, 192_000, 128_000, 96_000]));
  const opusBitrates = Array.from(new Set([Math.min(targetBitrate, 256_000), 192_000, 128_000, 96_000, 64_000]));
  const ratesToTest = Array.from(new Set([preferredRate === 44_100 ? 44_100 : 48_000, 48_000, 44_100]));
  const channelsToTest = Array.from(new Set([preferredChannels === 1 ? 1 : 2, 2, 1]));

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
            return { config: support.config || candidate, codec: 'aac' };
          }
        } catch {}
      }
    }
  }

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
            return { config: support.config || candidate, codec: 'opus' };
          }
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Keeps encoded H.264 video and completely separated Windows/Mic audio rings in memory,
 * muxing standalone `.m4a` track files plus a seekable MP4 when clipped.
 */
export class Mp4RollingEncoder {
  private readonly maxDurationUs: number;
  private readonly requestedFrameRate: number;

  private videoEncoder: VideoEncoder | null = null;
  private videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;

  private videoChunks: StoredVideoChunk[] = [];
  private videoDecoderConfig: VideoDecoderConfig | null = null;

  private gameRing: SeparatedTrackRing = createSeparatedTrackRing('game');
  private micRing: SeparatedTrackRing = createSeparatedTrackRing('mic');

  private running = false;
  private paused = false;
  private lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
  private droppedFrames = 0;
  private width = 0;
  private height = 0;
  private configuredFrameRate = 60;
  private videoReadTask: Promise<void> | null = null;
  private startupReadyPromise: Promise<void> | null = null;
  private resolveStartupReady: (() => void) | null = null;
  private rejectStartupReady: ((error: Error) => void) | null = null;
  private encoderError: Error | null = null;
  private sessionStartPerfMs = 0;
  private videoInputOriginUs: number | null = null;
  private videoBaseOffsetUs = 0;
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

  public async start(
    videoTrack: MediaStreamTrack,
    audioInput?: MediaStreamTrack | SeparatedAudioTracks | null,
  ): Promise<void> {
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
    this.sessionStartPerfMs = performance.now();
    this.videoInputOriginUs = null;
    this.videoBaseOffsetUs = 0;
    this.videoReadTask = this.readVideoFrames();

    const separatedTracks: SeparatedAudioTracks = audioInput instanceof MediaStreamTrack
      ? { gameAudioTrack: audioInput, micAudioTrack: null }
      : {
          gameAudioTrack: audioInput?.gameAudioTrack ?? null,
          micAudioTrack: audioInput?.micAudioTrack ?? null,
        };

    if (globalThis.AudioEncoder && globalThis.EncodedAudioChunk) {
      const targetBitrate = audioMixer.getConfig().audioBitrate || 256_000;
      if (separatedTracks.gameAudioTrack?.readyState === 'live') {
        await this.startSeparatedAudioRing(this.gameRing, separatedTracks.gameAudioTrack, Processor, targetBitrate);
      }
      if (separatedTracks.micAudioTrack?.readyState === 'live') {
        await this.startSeparatedAudioRing(this.micRing, separatedTracks.micAudioTrack, Processor, targetBitrate);
      }
    }

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
    this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
  }

  public async snapshot(): Promise<Mp4Snapshot> {
    if (!this.videoEncoder || this.videoEncoder.state !== 'configured') {
      throw this.encoderError || new Error('The H.264 encoder is not running.');
    }

    await this.videoEncoder.flush();
    if (this.gameRing.encoder?.state === 'configured') await this.gameRing.encoder.flush();
    if (this.micRing.encoder?.state === 'configured') await this.micRing.encoder.flush();

    if (!this.hasUsableKeyframe()) {
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

    if (startIndex < 0 && this.running && !this.paused) {
      const previousNewestTimestamp = newestTimestamp;
      this.lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
      await this.waitForKeyframeAfter(previousNewestTimestamp, 2_000);
      await this.videoEncoder.flush();
      if (this.gameRing.encoder?.state === 'configured') await this.gameRing.encoder.flush();
      if (this.micRing.encoder?.state === 'configured') await this.micRing.encoder.flush();

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

    const gameWindowChunks = this.gameRing.chunks.filter(
      chunk => chunk.timestamp >= startTimestamp && chunk.timestamp <= endTimestamp,
    );
    const micWindowChunks = this.micRing.chunks.filter(
      chunk => chunk.timestamp >= startTimestamp && chunk.timestamp <= endTimestamp,
    );

    const gameAudioBlob = this.muxAudioOnlyBlob(this.gameRing, gameWindowChunks, startTimestamp);
    const micAudioBlob = this.muxAudioOnlyBlob(this.micRing, micWindowChunks, startTimestamp);

    // Prepare the embedded MP4 audio track (offline sample-accurate mix if both tracks exist)
    let embeddedCodec: 'aac' | 'opus' = 'aac';
    let embeddedSampleRate = 48_000;
    let embeddedChannels = 2;
    let embeddedDecoderConfig: AudioDecoderConfig | null = null;
    let embeddedChunks: StoredAudioChunk[] = [];

    if (gameAudioBlob && micAudioBlob) {
      const gameOffsetSec = Math.max(0, (gameWindowChunks[0].timestamp - startTimestamp) / 1_000_000);
      const micOffsetSec = Math.max(0, (micWindowChunks[0].timestamp - startTimestamp) / 1_000_000);
      const mixed = await this.mixAudioBlobsOffline(
        gameAudioBlob,
        micAudioBlob,
        gameOffsetSec,
        micOffsetSec,
        audioMixer.getConfig().audioBitrate || 256_000,
      );
      if (mixed) {
        embeddedCodec = mixed.codec;
        embeddedSampleRate = mixed.sampleRate;
        embeddedChannels = mixed.channels;
        embeddedDecoderConfig = mixed.decoderConfig;
        embeddedChunks = mixed.chunks;
      } else {
        // Safe fallback to Windows audio track if offline decode fails
        embeddedCodec = this.gameRing.codec;
        embeddedSampleRate = this.gameRing.decoderConfig?.sampleRate || this.gameRing.sampleRate;
        embeddedChannels = this.gameRing.decoderConfig?.numberOfChannels || this.gameRing.channels;
        embeddedDecoderConfig = this.gameRing.decoderConfig;
        embeddedChunks = gameWindowChunks;
      }
    } else if (gameWindowChunks.length > 0) {
      embeddedCodec = this.gameRing.codec;
      embeddedSampleRate = this.gameRing.decoderConfig?.sampleRate || this.gameRing.sampleRate;
      embeddedChannels = this.gameRing.decoderConfig?.numberOfChannels || this.gameRing.channels;
      embeddedDecoderConfig = this.gameRing.decoderConfig;
      embeddedChunks = gameWindowChunks;
    } else if (micWindowChunks.length > 0) {
      embeddedCodec = this.micRing.codec;
      embeddedSampleRate = this.micRing.decoderConfig?.sampleRate || this.micRing.sampleRate;
      embeddedChannels = this.micRing.decoderConfig?.numberOfChannels || this.micRing.channels;
      embeddedDecoderConfig = this.micRing.decoderConfig;
      embeddedChunks = micWindowChunks;
    }

    const measuredDurationUs = Math.max(
      ...videoChunks.map(chunk => chunk.timestamp + (chunk.duration || 0)),
      ...gameWindowChunks.map(chunk => chunk.timestamp + (chunk.duration || 0)),
      ...micWindowChunks.map(chunk => chunk.timestamp + (chunk.duration || 0)),
    ) - startTimestamp;
    const durationSeconds = Math.max(0.001, measuredDurationUs / 1_000_000);

    const hasEmbeddedAudio = embeddedChunks.length > 0;
    const fallbackAudioDurationUs = Math.round(
      ((embeddedCodec === 'aac' ? 1024 : 960) / embeddedSampleRate) * 1_000_000,
    );

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: this.width,
        height: this.height,
        frameRate: outputFrameRate,
      },
      ...(hasEmbeddedAudio
        ? {
            audio: {
              codec: embeddedCodec,
              numberOfChannels: embeddedChannels,
              sampleRate: embeddedSampleRate,
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

    if (hasEmbeddedAudio) {
      const alreadyRelative = Boolean(gameAudioBlob && micAudioBlob && embeddedChunks !== gameWindowChunks);
      let lastRelativeAudioTime = -1;
      embeddedChunks.forEach((chunk, index) => {
        const metadata = index === 0 && embeddedDecoderConfig
          ? {
              decoderConfig: {
                ...embeddedDecoderConfig,
                description: copyDescription(embeddedDecoderConfig.description),
              },
            }
          : undefined;
        const duration = chunk.duration > 0 ? chunk.duration : fallbackAudioDurationUs;
        let relativeTime = alreadyRelative
          ? Math.max(0, chunk.timestamp)
          : Math.max(0, chunk.timestamp - startTimestamp);
        if (relativeTime <= lastRelativeAudioTime) {
          relativeTime = lastRelativeAudioTime + Math.max(1, duration);
        }
        lastRelativeAudioTime = relativeTime;
        muxer.addAudioChunkRaw(chunk.data, chunk.type, relativeTime, duration, metadata);
      });
    }

    muxer.finalize();

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      gameAudioBlob,
      micAudioBlob,
      durationSeconds,
      frameRate: outputFrameRate,
      width: this.width,
      height: this.height,
      droppedFrames: this.droppedFrames,
    };
  }

  private muxAudioOnlyBlob(
    ring: SeparatedTrackRing,
    windowChunks: StoredAudioChunk[],
    startTimestamp: number,
  ): Blob | undefined {
    if (windowChunks.length === 0) return undefined;

    const sampleRate = ring.decoderConfig?.sampleRate || ring.sampleRate || 48_000;
    const channels = ring.decoderConfig?.numberOfChannels || ring.channels || 2;
    const fallbackDurationUs = Math.round(((ring.codec === 'aac' ? 1024 : 960) / sampleRate) * 1_000_000);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      audio: {
        codec: ring.codec,
        numberOfChannels: channels,
        sampleRate,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let lastRelativeTime = -1;
    windowChunks.forEach((chunk, index) => {
      const metadata = index === 0 && ring.decoderConfig
        ? {
            decoderConfig: {
              ...ring.decoderConfig,
              description: copyDescription(ring.decoderConfig.description),
            },
          }
        : undefined;
      const duration = chunk.duration > 0 ? chunk.duration : fallbackDurationUs;
      let relativeTime = Math.max(0, chunk.timestamp - startTimestamp);
      if (relativeTime <= lastRelativeTime) {
        relativeTime = lastRelativeTime + Math.max(1, duration);
      }
      lastRelativeTime = relativeTime;
      muxer.addAudioChunkRaw(chunk.data, chunk.type, relativeTime, duration, metadata);
    });

    muxer.finalize();
    return new Blob([target.buffer], { type: 'audio/mp4' });
  }

  private async mixAudioBlobsOffline(
    gameBlob: Blob,
    micBlob: Blob,
    gameOffsetSec: number,
    micOffsetSec: number,
    targetBitrate: number,
  ): Promise<{
    codec: 'aac' | 'opus';
    sampleRate: number;
    channels: number;
    decoderConfig: AudioDecoderConfig | null;
    chunks: StoredAudioChunk[];
  } | null> {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass || !globalThis.AudioEncoder || !globalThis.AudioData) return null;

    const audioCtx = new AudioCtxClass();
    try {
      const [gameArr, micArr] = await Promise.all([gameBlob.arrayBuffer(), micBlob.arrayBuffer()]);
      const [gameBuf, micBuf] = await Promise.all([
        audioCtx.decodeAudioData(gameArr),
        audioCtx.decodeAudioData(micArr),
      ]);

      const sampleRate = gameBuf.sampleRate === 44_100 ? 44_100 : 48_000;
      const channels = 2;
      const selected = await selectSupportedAudioConfig(sampleRate, channels, targetBitrate);
      if (!selected) return null;

      const encSampleRate = selected.config.sampleRate;
      const encChannels = selected.config.numberOfChannels;

      const gStart = Math.round(gameOffsetSec * encSampleRate);
      const mStart = Math.round(micOffsetSec * encSampleRate);
      const gLen = Math.round((gameBuf.length * encSampleRate) / gameBuf.sampleRate);
      const mLen = Math.round((micBuf.length * encSampleRate) / micBuf.sampleRate);
      const totalSamples = Math.max(gStart + gLen, mStart + mLen);
      if (totalSamples <= 0) return null;

      const outChunks: StoredAudioChunk[] = [];
      let outDecoderConfig: AudioDecoderConfig | null = null;
      const fallbackDur = Math.round(((selected.codec === 'aac' ? 1024 : 960) / encSampleRate) * 1_000_000);

      const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
          if (metadata?.decoderConfig) {
            outDecoderConfig = {
              ...metadata.decoderConfig,
              description: copyDescription(metadata.decoderConfig.description),
            };
          }
          outChunks.push({
            type: chunk.type,
            timestamp: Math.max(0, chunk.timestamp),
            duration: chunk.duration && chunk.duration > 0 ? chunk.duration : fallbackDur,
            data: copyChunk(chunk),
          });
        },
        error: err => console.warn('Offline snapshot audio mix encoder error:', err),
      });
      encoder.configure(selected.config);

      const gRatio = gameBuf.sampleRate / encSampleRate;
      const mRatio = micBuf.sampleRate / encSampleRate;
      const frameSize = 1024;

      for (let offset = 0; offset < totalSamples; offset += frameSize) {
        const count = Math.min(frameSize, totalSamples - offset);
        const planarData = new Float32Array(count * encChannels);

        for (let ch = 0; ch < encChannels; ch++) {
          const gSrc = gameBuf.getChannelData(Math.min(ch, gameBuf.numberOfChannels - 1));
          const mSrc = micBuf.getChannelData(Math.min(ch, micBuf.numberOfChannels - 1));
          const dstOffset = ch * count;

          for (let i = 0; i < count; i++) {
            const globalIdx = offset + i;
            let gVal = 0;
            const gIdx = globalIdx - gStart;
            if (gIdx >= 0 && gIdx < gLen) {
              if (gameBuf.sampleRate === encSampleRate) {
                gVal = gSrc[gIdx] || 0;
              } else {
                const pos = gIdx * gRatio;
                const i0 = Math.floor(pos);
                if (i0 < gSrc.length) {
                  const i1 = Math.min(gSrc.length - 1, i0 + 1);
                  const frac = pos - i0;
                  gVal = gSrc[i0] * (1 - frac) + gSrc[i1] * frac;
                }
              }
            }

            let mVal = 0;
            const mIdx = globalIdx - mStart;
            if (mIdx >= 0 && mIdx < mLen) {
              if (micBuf.sampleRate === encSampleRate) {
                mVal = mSrc[mIdx] || 0;
              } else {
                const pos = mIdx * mRatio;
                const i0 = Math.floor(pos);
                if (i0 < mSrc.length) {
                  const i1 = Math.min(mSrc.length - 1, i0 + 1);
                  const frac = pos - i0;
                  mVal = mSrc[i0] * (1 - frac) + mSrc[i1] * frac;
                }
              }
            }

            planarData[dstOffset + i] = softLimitAudio(gVal + mVal);
          }
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: encSampleRate,
          numberOfChannels: encChannels,
          numberOfFrames: count,
          timestamp: Math.round((offset / encSampleRate) * 1_000_000),
          data: planarData,
        });
        encoder.encode(audioData);
        audioData.close();
      }

      await encoder.flush();
      encoder.close();

      return {
        codec: selected.codec,
        sampleRate: encSampleRate,
        channels: encChannels,
        decoderConfig: outDecoderConfig,
        chunks: outChunks,
      };
    } catch (err) {
      console.warn('Offline audio mix failed, falling back to single track:', err);
      return null;
    } finally {
      try { await audioCtx.close(); } catch {}
    }
  }

  public stop(): void {
    this.running = false;
    void this.videoReader?.cancel().catch(() => undefined);
    void this.gameRing.reader?.cancel().catch(() => undefined);
    void this.micRing.reader?.cancel().catch(() => undefined);
    this.videoReader = null;

    if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
      this.videoEncoder.close();
    }
    if (this.gameRing.encoder && this.gameRing.encoder.state !== 'closed') {
      this.gameRing.encoder.close();
    }
    if (this.micRing.encoder && this.micRing.encoder.state !== 'closed') {
      this.micRing.encoder.close();
    }
    this.videoEncoder = null;
    this.videoChunks = [];
    this.videoDecoderConfig = null;
    this.gameRing = createSeparatedTrackRing('game');
    this.micRing = createSeparatedTrackRing('mic');
    this.videoReadTask = null;
    this.sessionStartPerfMs = 0;
    this.videoInputOriginUs = null;
    this.videoBaseOffsetUs = 0;
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
      + this.gameRing.chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0)
      + this.micRing.chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0);
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
        } catch {}
      }
    }

    if (supportedConfigs.length === 0) {
      throw new Error(`H.264 encoding is unavailable for ${this.width}x${this.height}@${this.configuredFrameRate}.`);
    }
    return supportedConfigs;
  }

  private async startSeparatedAudioRing(
    ring: SeparatedTrackRing,
    track: MediaStreamTrack,
    Processor: TrackProcessorConstructor,
    targetBitrate: number,
  ): Promise<void> {
    try {
      const settings = track.getSettings();
      const rawRate = settings.sampleRate || 48_000;
      const trackChannels = Math.min(2, Math.max(1, settings.channelCount || 2));

      const selected = await selectSupportedAudioConfig(rawRate, trackChannels, targetBitrate);
      if (!selected) {
        console.warn(`No supported AudioEncoder config for ${ring.kind} track.`);
        return;
      }

      ring.codec = selected.codec;
      ring.sampleRate = selected.config.sampleRate;
      ring.channels = selected.config.numberOfChannels;

      ring.encoder = new AudioEncoder({
        output: (chunk, metadata) => this.handleSeparatedAudioChunk(ring, chunk, metadata),
        error: error => {
          console.error(`MP4 ${ring.kind} audio encoder error:`, error instanceof Error ? error.message : String(error));
        },
      });
      ring.encoder.configure(selected.config);

      const processor = new Processor<AudioData>({ track, maxBufferSize: 16 });
      ring.reader = processor.readable.getReader();
      ring.readTask = this.readSeparatedAudioFrames(ring);
      console.log(`[Mp4RollingEncoder] Separated ${ring.kind} audio initialized: ${ring.codec} @ ${ring.sampleRate}Hz, ${ring.channels}ch`);
    } catch (error) {
      console.warn(`Unable to initialize ${ring.kind} audio capture:`, error);
      if (ring.encoder && ring.encoder.state !== 'closed') {
        ring.encoder.close();
      }
      ring.encoder = null;
      ring.reader = null;
    }
  }

  private async readVideoFrames(): Promise<void> {
    try {
      while (this.running && this.videoReader) {
        const { value: frame, done } = await this.videoReader.read();
        if (done || !frame) break;

        try {
          if (this.videoInputOriginUs === null) {
            this.videoInputOriginUs = frame.timestamp;
            this.videoBaseOffsetUs = Math.max(0, Math.round((performance.now() - this.sessionStartPerfMs) * 1000));
          }
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

  private async readSeparatedAudioFrames(ring: SeparatedTrackRing): Promise<void> {
    let lastGameMeterAt = 0;
    let meterScratch = new Float32Array(2048);

    while (this.running && ring.reader) {
      const { value: audioData, done } = await ring.reader.read();
      if (done || !audioData) break;
      try {
        if (ring.inputOriginUs === null) {
          ring.inputOriginUs = audioData.timestamp;
          ring.baseOffsetUs = Math.max(0, Math.round((performance.now() - this.sessionStartPerfMs) * 1000));
        }
        if (this.paused || audioData.numberOfFrames === 0) continue;
        if (!ring.encoder || ring.encoder.state !== 'configured') continue;
        if (ring.encoder.encodeQueueSize > 32) continue;

        let gain = 1.0;
        if (ring.kind === 'game') {
          const cfg = audioMixer.getConfig();
          gain = cfg.isGameAudioMuted ? 0 : Math.max(0, Math.min(1, cfg.gameVolume));

          const now = performance.now();
          if (now - lastGameMeterAt >= 40) {
            lastGameMeterAt = now;
            if (gain <= 0) {
              audioMixer.reportGameAudioLevel(-80);
            } else {
              const frames = audioData.numberOfFrames;
              if (meterScratch.length < frames) {
                meterScratch = new Float32Array(frames);
              }
              const view = meterScratch.subarray(0, frames);
              audioData.copyTo(view, { planeIndex: 0, format: 'f32-planar' });
              let sumSq = 0;
              for (let i = 0; i < frames; i++) {
                const s = view[i] * gain;
                sumSq += s * s;
              }
              const rms = Math.sqrt(sumSq / frames);
              const db = Math.max(-80, Math.round(20 * Math.log10(Math.max(rms, 0.0001))));
              audioMixer.reportGameAudioLevel(db);
            }
          }
        }

        if (
          gain >= 0.99 &&
          audioData.sampleRate === ring.sampleRate &&
          audioData.numberOfChannels === ring.channels
        ) {
          ring.encoder.encode(audioData);
        } else {
          const normalized = convertAudioDataForEncoder(audioData, ring.sampleRate, ring.channels, gain);
          try {
            ring.encoder.encode(normalized);
          } finally {
            normalized.close();
          }
        }
      } catch (encodeErr) {
        console.warn(`Failed to encode ${ring.kind} audio frame:`, encodeErr);
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
    const normalizedTimestamp = Math.max(
      0,
      this.videoBaseOffsetUs + (chunk.timestamp - (this.videoInputOriginUs ?? chunk.timestamp)),
    );
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

  private handleSeparatedAudioChunk(
    ring: SeparatedTrackRing,
    chunk: EncodedAudioChunk,
    metadata?: EncodedAudioChunkMetadata,
  ): void {
    if (metadata?.decoderConfig) {
      ring.decoderConfig = {
        ...metadata.decoderConfig,
        description: copyDescription(metadata.decoderConfig.description),
      };
    }
    const fallbackDurationUs = Math.round(
      ((ring.codec === 'aac' ? 1024 : 960) / (ring.sampleRate || 48_000)) * 1_000_000,
    );
    const duration = chunk.duration && chunk.duration > 0 ? chunk.duration : fallbackDurationUs;
    let normalizedTimestamp = Math.max(
      0,
      ring.baseOffsetUs + (chunk.timestamp - (ring.inputOriginUs ?? chunk.timestamp)),
    );
    if (ring.lastChunkTimestamp !== null && normalizedTimestamp <= ring.lastChunkTimestamp) {
      normalizedTimestamp = ring.lastChunkTimestamp + Math.max(1, ring.lastChunkDuration || fallbackDurationUs);
    }
    ring.lastChunkTimestamp = normalizedTimestamp;
    ring.lastChunkDuration = duration;

    ring.chunks.push({
      type: chunk.type,
      timestamp: normalizedTimestamp,
      duration,
      data: copyChunk(chunk),
    });
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

  private pruneAudioChunks(chunks: StoredAudioChunk[], keepTimestamp: number): void {
    const audioKeepIndex = chunks.findIndex(chunk => (chunk.timestamp + (chunk.duration || 0)) >= keepTimestamp);
    if (audioKeepIndex > 0) {
      chunks.splice(0, audioKeepIndex);
    } else if (audioKeepIndex === -1 && chunks.length > 0) {
      chunks.length = 0;
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
      this.pruneAudioChunks(this.gameRing.chunks, keepTimestamp);
      this.pruneAudioChunks(this.micRing.chunks, keepTimestamp);
    }
  }
}
