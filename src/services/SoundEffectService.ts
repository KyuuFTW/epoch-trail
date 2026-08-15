/**
 * SoundEffectService
 * Synthesizes crisp tactical audio cues using Web Audio API for zero-latency in-game feedback.
 */
class SoundEffectService {
  private audioCtx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Plays a crisp high-tech two-tone tactical capture chime (540Hz -> 880Hz)
   */
  public playClipCapturedSound(): void {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Master Gain for smooth volume control
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.28, now);
      masterGain.connect(ctx.destination);

      // Tone 1: Initial chirp (520Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(520, now);
      osc1.frequency.exponentialRampToValueAtTime(740, now + 0.08);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.8, now + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc1.connect(gain1);
      gain1.connect(masterGain);

      // Tone 2: Confirmation chime (880Hz harmonics)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.07);
      osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.22);

      gain2.gain.setValueAtTime(0, now + 0.07);
      gain2.gain.linearRampToValueAtTime(0.9, now + 0.085);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc2.connect(gain2);
      gain2.connect(masterGain);

      // Start oscillators
      osc1.start(now);
      osc1.stop(now + 0.14);

      osc2.start(now + 0.07);
      osc2.stop(now + 0.30);
    } catch (err) {
      console.warn('Audio cue failed:', err);
    }
  }
}

export const soundEffects = new SoundEffectService();
