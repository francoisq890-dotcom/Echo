export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private vibrationEnabled = true;
  private lastTickTime = 0;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setVibration(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  vibrate(pattern: number | number[]): void {
    if (!this.vibrationEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore on unsupported browsers
      }
    }
  }

  private ready(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playShot(weaponTier = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;
    const baseFreq = (420 + weaponTier * 45) * pitchVar;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = weaponTier >= 2 ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.085);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  playHit(stage: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freq = (260 + stage * 110) * (0.95 + Math.random() * 0.1);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + 0.06);

    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playShatter(isGolden = false, isExplosive = false): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Low crystal punch
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = isExplosive ? 'sawtooth' : 'sine';
    low.frequency.setValueAtTime(isExplosive ? 150 : 210, now);
    low.frequency.exponentialRampToValueAtTime(42, now + (isExplosive ? 0.24 : 0.15));
    lowGain.gain.setValueAtTime(isExplosive ? 0.2 : 0.14, now);
    lowGain.gain.exponentialRampToValueAtTime(0.001, now + (isExplosive ? 0.26 : 0.16));
    low.connect(lowGain).connect(ctx.destination);
    low.start(now);
    low.stop(now + 0.27);

    // High crystalline shimmer
    const chime = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chime.type = 'triangle';
    const base = isGolden ? 1046 : 740;
    chime.frequency.setValueAtTime(base, now);
    chime.frequency.exponentialRampToValueAtTime(base * 1.45, now + 0.11);
    chimeGain.gain.setValueAtTime(0.09, now);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    chime.connect(chimeGain).connect(ctx.destination);
    chime.start(now);
    chime.stop(now + 0.15);
  }

  playShardTick(combo: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastTickTime < 0.032) return;
    this.lastTickTime = now;

    const semitones = Math.min(24, combo);
    const freq = 540 * Math.pow(2, semitones / 16);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.18, now + 0.055);

    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  playJump(isPad = false): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isPad ? 220 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(isPad ? 680 : 320, now + (isPad ? 0.18 : 0.1));

    gain.gain.setValueAtTime(isPad ? 0.12 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isPad ? 0.19 : 0.11));

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playLoopRewind(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Reverse sweep
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'triangle';
    sweep.frequency.setValueAtTime(160, now);
    sweep.frequency.exponentialRampToValueAtTime(880, now + 0.28);
    sweep.frequency.exponentialRampToValueAtTime(320, now + 0.48);
    sweepGain.gain.setValueAtTime(0.01, now);
    sweepGain.gain.linearRampToValueAtTime(0.15, now + 0.22);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sweep.connect(sweepGain).connect(ctx.destination);
    sweep.start(now);
    sweep.stop(now + 0.52);

    // Echo materialization chord
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, now + 0.18 + idx * 0.03);
      g.gain.setValueAtTime(0.06, now + 0.18 + idx * 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      o.connect(g).connect(ctx.destination);
      o.start(now + 0.18 + idx * 0.03);
      o.stop(now + 0.6);
    });
  }

  playUpgrade(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  playCollapse(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bass = ctx.createOscillator();
    const bg = ctx.createGain();
    bass.type = 'sawtooth';
    bass.frequency.setValueAtTime(180, now);
    bass.frequency.exponentialRampToValueAtTime(36, now + 0.65);
    bg.gain.setValueAtTime(0.22, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    bass.connect(bg).connect(ctx.destination);
    bass.start(now);
    bass.stop(now + 0.72);
  }

  playRelayShot(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1420, now + 0.08);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playTwinSync(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    [587.33, 880, 1174.66].forEach((freq, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, now + idx * 0.025);
      g.gain.setValueAtTime(0.09, now + idx * 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      o.connect(g).connect(ctx.destination);
      o.start(now + idx * 0.025);
      o.stop(now + 0.25);
    });
  }

  playSwitchToggle(active: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(active ? 392 : 520, now);
    osc.frequency.exponentialRampToValueAtTime(active ? 784 : 290, now + 0.14);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playDash(reset: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(reset ? 660 : 280, now);
    osc.frequency.exponentialRampToValueAtTime(reset ? 1120 : 120, now + 0.12);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  playDevourerAlert(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(115, now + 0.18);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playDevourerSlain(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.16);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }
}
