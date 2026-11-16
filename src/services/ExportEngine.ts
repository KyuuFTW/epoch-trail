import { TacticalAnnotation, ExportOptions } from '../types';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { audioMixer } from './AudioMixer';

export class ExportEngine {
  public static async exportFlattenedVideo(
    videoSourceUrl: string,
    annotations: TacticalAnnotation[],
    options: ExportOptions,
    onProgress: (percent: number, status: string) => void
  ): Promise<Blob> {
    onProgress(5, 'Loading source video for flattening...');
    const video = document.createElement('video');
    video.src = videoSourceUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video metadata for export.'));
    });

    if (!globalThis.VideoEncoder || !globalThis.VideoFrame) {
      throw new Error('MP4 export requires the Windows WebCodecs H.264 encoder.');
    }

    const width = Math.max(2, Math.floor((video.videoWidth || 1920) / 2) * 2);
    const height = Math.max(2, Math.floor((video.videoHeight || 1080) / 2) * 2);
    const duration = video.duration || 60;
    const startTime = options.timeRange ? Math.max(0, options.timeRange[0]) : 0;
    const endTime = options.timeRange ? Math.min(duration, options.timeRange[1]) : duration;
    const totalExportDuration = endTime - startTime;
    if (totalExportDuration <= 0) throw new Error('Invalid export time range.');

    onProgress(10, 'Checking audio tracks and configuring encoder...');
    
    // Try to decode audio from separated tracks (if available) or source video
    let audioBuffer: AudioBuffer | null = null;
    let audioSampleRate = 48_000;
    let audioChannels = 2;
    let hasAudio = false;

    const hasSeparatedTracks = Boolean(options.gameAudioUrl || options.micAudioUrl);
    const includeGame = options.includeGameAudio !== false;
    const includeMic = options.includeMicAudio !== false;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        const audioCtx = new AudioCtxClass();
        try {
          const decodeUrl = async (url: string): Promise<AudioBuffer | null> => {
            try {
              const resp = await fetch(url);
              const arrayBuf = await resp.arrayBuffer();
              if (arrayBuf.byteLength === 0) return null;
              const decoded = await audioCtx.decodeAudioData(arrayBuf);
              return decoded && decoded.numberOfChannels > 0 && decoded.duration > 0 ? decoded : null;
            } catch {
              return null;
            }
          };

          if (hasSeparatedTracks) {
            const buffers: AudioBuffer[] = [];
            if (includeGame && options.gameAudioUrl) {
              const gameBuf = await decodeUrl(options.gameAudioUrl);
              if (gameBuf) buffers.push(gameBuf);
            }
            if (includeMic && options.micAudioUrl) {
              const micBuf = await decodeUrl(options.micAudioUrl);
              if (micBuf) buffers.push(micBuf);
            }
            if (buffers.length === 1) {
              audioBuffer = buffers[0];
            } else if (buffers.length === 2) {
              const [b1, b2] = buffers;
              const targetRate = b1.sampleRate;
              const outChannels = Math.min(2, Math.max(b1.numberOfChannels, b2.numberOfChannels));
              const b2LengthAtRate = Math.round((b2.length * targetRate) / b2.sampleRate);
              const outLength = Math.max(b1.length, b2LengthAtRate);
              const mixed = audioCtx.createBuffer(outChannels, outLength, targetRate);
              const ratio2 = b2.sampleRate / targetRate;
              for (let ch = 0; ch < outChannels; ch++) {
                const dst = mixed.getChannelData(ch);
                const src1 = b1.getChannelData(Math.min(ch, b1.numberOfChannels - 1));
                const src2 = b2.getChannelData(Math.min(ch, b2.numberOfChannels - 1));
                for (let i = 0; i < outLength; i++) {
                  const s1 = i < src1.length ? src1[i] : 0;
                  let s2 = 0;
                  if (b2.sampleRate === targetRate) {
                    s2 = i < src2.length ? src2[i] : 0;
                  } else {
                    const pos = i * ratio2;
                    const idx0 = Math.floor(pos);
                    if (idx0 < src2.length) {
                      const idx1 = Math.min(src2.length - 1, idx0 + 1);
                      const frac = pos - idx0;
                      s2 = src2[idx0] * (1 - frac) + src2[idx1] * frac;
                    }
                  }
                  const sum = s1 + s2;
                  dst[i] = sum > 1 ? 1 : sum < -1 ? -1 : sum;
                }
              }
              audioBuffer = mixed;
            }
          } else if (includeGame || includeMic) {
            audioBuffer = await decodeUrl(videoSourceUrl);
          }

          if (audioBuffer && audioBuffer.numberOfChannels > 0 && audioBuffer.duration > 0) {
            hasAudio = true;
            audioSampleRate = audioBuffer.sampleRate;
            audioChannels = Math.min(2, audioBuffer.numberOfChannels);
          }
        } finally {
          try { audioCtx.close(); } catch {}
        }
      }
    } catch (e) {
      console.warn('Could not extract audio for export, exporting video only:', e);
    }

    let chosenAudioConfig: AudioEncoderConfig | null = null;
    let chosenAudioCodec: 'aac' | 'opus' = 'aac';

    if (hasAudio && audioBuffer && globalThis.AudioEncoder && globalThis.AudioData) {
      const targetBitrate = audioMixer.getConfig().audioBitrate || 256_000;
      const aacBitrates = Array.from(new Set([targetBitrate, 384_000, 320_000, 256_000, 192_000, 128_000, 96_000]));
      const opusBitrates = Array.from(new Set([Math.min(targetBitrate, 256_000), 192_000, 128_000, 96_000, 64_000]));

      // 1. Try AAC first
      for (const bitrate of aacBitrates) {
        const candidate: AudioEncoderConfig = {
          codec: 'mp4a.40.2',
          sampleRate: audioSampleRate,
          numberOfChannels: audioChannels,
          bitrate,
        };
        try {
          const support = await AudioEncoder.isConfigSupported(candidate);
          if (support.supported) {
            chosenAudioConfig = support.config || candidate;
            chosenAudioCodec = 'aac';
            break;
          }
        } catch {}
      }

      // 2. Fall back to Opus if AAC is unavailable
      if (!chosenAudioConfig) {
        for (const bitrate of opusBitrates) {
          const candidate: AudioEncoderConfig = {
            codec: 'opus',
            sampleRate: 48_000,
            numberOfChannels: audioChannels,
            bitrate,
          };
          try {
            const support = await AudioEncoder.isConfigSupported(candidate);
            if (support.supported) {
              chosenAudioConfig = support.config || candidate;
              chosenAudioCodec = 'opus';
              audioSampleRate = 48_000;
              break;
            }
          } catch {}
        }
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to create the export canvas.');

    const encoderConfig = await this.selectH264ExportConfig(width, height);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width, height },
      ...(hasAudio && chosenAudioConfig ? {
        audio: {
          codec: chosenAudioCodec,
          numberOfChannels: audioChannels,
          sampleRate: audioSampleRate,
        }
      } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    // Encode audio frames if audio is available
    if (hasAudio && audioBuffer && chosenAudioConfig && globalThis.AudioEncoder && globalThis.AudioData) {
      try {
        const audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
          error: err => console.warn('Export audio encoder error:', err),
        });
        audioEncoder.configure(chosenAudioConfig);

        const sourceSampleRate = audioBuffer.sampleRate;
        const startSample = Math.floor(startTime * sourceSampleRate);
        const endSample = Math.min(audioBuffer.length, Math.floor(endTime * sourceSampleRate));
        const frameSize = 1024;
        for (let offset = startSample; offset < endSample; offset += frameSize) {
          const srcChunkFrames = Math.min(frameSize, endSample - offset);
          const timestamp = Math.max(0, Math.round(((offset - startSample) / sourceSampleRate) * 1_000_000));

          if (sourceSampleRate === audioSampleRate) {
            const planarData = new Float32Array(srcChunkFrames * audioChannels);
            for (let ch = 0; ch < audioChannels; ch++) {
              const channelData = audioBuffer.getChannelData(Math.min(ch, audioBuffer.numberOfChannels - 1));
              planarData.set(channelData.subarray(offset, offset + srcChunkFrames), ch * srcChunkFrames);
            }
            const audioData = new AudioData({
              format: 'f32-planar',
              sampleRate: audioSampleRate,
              numberOfChannels: audioChannels,
              numberOfFrames: srcChunkFrames,
              timestamp,
              data: planarData,
            });
            audioEncoder.encode(audioData);
            audioData.close();
          } else {
            const outFrames = Math.max(1, Math.round((srcChunkFrames * audioSampleRate) / sourceSampleRate));
            const ratio = srcChunkFrames / outFrames;
            const planarData = new Float32Array(outFrames * audioChannels);
            for (let ch = 0; ch < audioChannels; ch++) {
              const channelData = audioBuffer.getChannelData(Math.min(ch, audioBuffer.numberOfChannels - 1));
              const dstOffset = ch * outFrames;
              for (let i = 0; i < outFrames; i++) {
                const srcPos = offset + i * ratio;
                const idx0 = Math.min(endSample - 1, Math.floor(srcPos));
                const idx1 = Math.min(endSample - 1, idx0 + 1);
                const frac = srcPos - Math.floor(srcPos);
                planarData[dstOffset + i] = channelData[idx0] * (1 - frac) + channelData[idx1] * frac;
              }
            }
            const audioData = new AudioData({
              format: 'f32-planar',
              sampleRate: audioSampleRate,
              numberOfChannels: audioChannels,
              numberOfFrames: outFrames,
              timestamp,
              data: planarData,
            });
            audioEncoder.encode(audioData);
            audioData.close();
          }
        }
        await audioEncoder.flush();
        audioEncoder.close();
      } catch (audioEncErr) {
        console.warn('Failed to encode audio for export:', audioEncErr);
      }
    }

    let encoderFailure: DOMException | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: error => {
        encoderFailure = error;
      },
    });
    encoder.configure(encoderConfig);

    video.currentTime = startTime;
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('Could not seek the source video for export.'));
    });

    onProgress(25, 'Rendering tactical annotations into MP4 frames...');

    return await new Promise<Blob>((resolve, reject) => {
      let finished = false;
      let lastTimestamp = -1;
      let lastKeyframeTimestamp = Number.NEGATIVE_INFINITY;
      let lastProgress = -1;

      const finish = async () => {
        if (finished) return;
        finished = true;
        video.pause();
        try {
          await encoder.flush();
          encoder.close();
          if (encoderFailure) throw encoderFailure;
          muxer.finalize();
          onProgress(100, 'MP4 export complete!');
          resolve(new Blob([target.buffer], { type: 'video/mp4' }));
        } catch (error) {
          reject(error);
        }
      };

      const renderFrame: VideoFrameRequestCallback = (_now, metadata) => {
        if (finished) return;
        const currentTime = metadata.mediaTime;
        if (currentTime > endTime || video.ended) {
          void finish();
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);
        if (options.burnAnnotations) {
          this.renderAnnotationsOnContext(ctx, annotations, currentTime, width, height);
        }

        const timestamp = Math.max(0, Math.round((currentTime - startTime) * 1_000_000));
        if (timestamp > lastTimestamp) {
          const keyFrame = !Number.isFinite(lastKeyframeTimestamp)
            || timestamp - lastKeyframeTimestamp >= 1_000_000;
          const frame = new VideoFrame(canvas, { timestamp });
          encoder.encode(frame, { keyFrame });
          frame.close();
          lastTimestamp = timestamp;
          if (keyFrame) lastKeyframeTimestamp = timestamp;
        }

        const progress = Math.min(95, Math.round(25 + ((currentTime - startTime) / totalExportDuration) * 70));
        if (progress !== lastProgress) {
          lastProgress = progress;
          onProgress(progress, `Burning frame at ${currentTime.toFixed(1)}s / ${endTime.toFixed(1)}s...`);
        }

        if (currentTime >= endTime) {
          void finish();
        } else {
          video.requestVideoFrameCallback(renderFrame);
        }
      };

      video.onended = () => void finish();
      video.onerror = () => reject(new Error('Source video failed during MP4 export.'));
      video.requestVideoFrameCallback(renderFrame);
      video.play().catch(error => reject(new Error(`Could not play video for export: ${error.message}`)));
    });
  }

  private static async selectH264ExportConfig(width: number, height: number): Promise<VideoEncoderConfig> {
    const frameRate = 60;
    const bitrate = Math.round(Math.max(8_000_000, Math.min(50_000_000, width * height * frameRate * 0.1)));
    const level = width * height * frameRate > 2560 * 1440 * 60 ? '34' : width * height * frameRate > 1920 * 1080 * 60 ? '33' : '2A';

    for (const codec of [`avc1.6400${level}`, `avc1.4D00${level}`, `avc1.4200${level}`]) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        framerate: frameRate,
        bitrate,
        bitrateMode: 'variable',
        hardwareAcceleration: 'prefer-hardware',
        avc: { format: 'avc' },
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return support.config || config;
    }

    throw new Error(`H.264 MP4 export is unavailable for ${width}x${height}.`);
  }

  public static renderAnnotationsOnContext(
    ctx: CanvasRenderingContext2D,
    annotations: TacticalAnnotation[],
    currentTime: number,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    annotations.forEach(ann => {
      ctx.save();
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.strokeWidth * (canvasWidth / 1920);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Glow effect for tactical visibility
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 8;

      if (ann.tool === 'brush') {
        if (ann.points.length < 2) {
          ctx.restore();
          return;
        }
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * canvasWidth, ann.points[0].y * canvasHeight);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * canvasWidth, ann.points[i].y * canvasHeight);
        }
        ctx.stroke();
      } else if (ann.tool === 'arrow') {
        if (ann.points.length < 2) {
          ctx.restore();
          return;
        }
        const startX = ann.points[0].x * canvasWidth;
        const startY = ann.points[0].y * canvasHeight;
        const endX = ann.points[ann.points.length - 1].x * canvasWidth;
        const endY = ann.points[ann.points.length - 1].y * canvasHeight;

        // Draw main arrow shaft
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Calculate arrowhead geometry
        const headLength = 22 * (canvasWidth / 1920);
        const angle = Math.atan2(endY - startY, endX - startX);

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - headLength * Math.cos(angle - Math.PI / 6),
          endY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          endX - headLength * Math.cos(angle + Math.PI / 6),
          endY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      } else if (ann.tool === 'halo') {
        if (ann.points.length < 2) {
          ctx.restore();
          return;
        }
        const p1 = ann.points[0];
        const p2 = ann.points[ann.points.length - 1];
        const centerX = p1.x * canvasWidth;
        const centerY = p1.y * canvasHeight;
        const dx = (p2.x - p1.x) * canvasWidth;
        const dy = (p2.y - p1.y) * canvasHeight;
        const radius = Math.sqrt(dx * dx + dy * dy);

        // Player Halo circle with tactical dashed outline
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner translucent fill
        ctx.fillStyle = `${ann.color}22`;
        ctx.fill();
      } else if (ann.tool === 'rect') {
        if (ann.points.length < 2) {
          ctx.restore();
          return;
        }
        const p1 = ann.points[0];
        const p2 = ann.points[ann.points.length - 1];
        const minX = Math.min(p1.x, p2.x) * canvasWidth;
        const minY = Math.min(p1.y, p2.y) * canvasHeight;
        const w = Math.abs(p2.x - p1.x) * canvasWidth;
        const h = Math.abs(p2.y - p1.y) * canvasHeight;

        ctx.strokeRect(minX, minY, w, h);
        ctx.fillStyle = `${ann.color}15`;
        ctx.fillRect(minX, minY, w, h);
      } else if (ann.tool === 'text' && ann.text) {
        const x = ann.points[0].x * canvasWidth;
        const y = ann.points[0].y * canvasHeight;
        const fontSize = (ann.fontSize || 20) * (canvasWidth / 1920);

        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, x, y);
      }

      ctx.restore();
    });
  }
}
