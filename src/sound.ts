// Thrust Sound Effects — Web Audio API implementation
// Derived from BBC Micro SN76489 square wave synthesis

class EngineSound {
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private filter: BiquadFilterNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    const bufferSize = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    // Low-pass filter for deeper rumble (BBC Micro noise type 5 = medium freq)
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 0.7;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter.connect(this.gain).connect(destination);
  }

  start(): void {
    if (this.source) return;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.noiseBuffer;
    this.source.loop = true;
    this.source.connect(this.filter);
    this.source.start();
    this.gain.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.02);
  }

  stop(): void {
    if (!this.source) return;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const src = this.source;
    this.source = null;
    setTimeout(() => { try { src.stop(); } catch (_) {} }, 150);
  }

  get active(): boolean {
    return this.source !== null;
  }
}

class ShieldSound {
  private ctx: AudioContext;
  private osc: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private destination: AudioNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  start(): void {
    if (this.osc) return;

    this.osc = this.ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 120;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    // 12.5Hz pulsing (vsync_count AND $02 toggle)
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 12.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.15;
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.gain.gain);

    this.osc.connect(this.gain).connect(this.destination);
    this.osc.start();
    this.lfo.start();
  }

  stop(): void {
    if (!this.osc) return;
    try { this.osc.stop(); } catch (_) {}
    try { this.lfo!.stop(); } catch (_) {}
    this.osc = null;
    this.lfo = null;
    this.gain = null;
  }

  get active(): boolean {
    return this.osc !== null;
  }
}

export class ThrustSounds {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private engine: EngineSound;
  private shield: ShieldSound;
  private soundTimer: number = 0;
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);
    this.engine = new EngineSound(this.ctx, this.masterGain);
    this.shield = new ShieldSound(this.ctx, this.masterGain);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Call every game tick to decrement the explosion blocking timer. */
  tick(): void {
    if (this.soundTimer > 0) this.soundTimer--;
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const size = this.ctx.sampleRate * 3;
    this.noiseBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    return this.noiseBuffer;
  }

  /** Downward square wave sweep — classic 8-bit "pew" laser. */
  playOwnGun(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.35);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.36);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** White noise burst with tonal body — destruction event. */
  playExplosion(): void {
    this.soundTimer = 31;
    const t = this.ctx.currentTime;

    // Layer 1: Low-pass filtered noise burst for deeper explosion
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer();
    const nFilter = this.ctx.createBiquadFilter();
    nFilter.type = 'lowpass';
    nFilter.frequency.setValueAtTime(600, t);
    nFilter.frequency.exponentialRampToValueAtTime(200, t + 1.0);
    nFilter.Q.value = 0.8;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.6, t);
    nGain.gain.linearRampToValueAtTime(0.4, t + 0.2);
    nGain.gain.linearRampToValueAtTime(0, t + 2.4);
    noise.connect(nFilter).connect(nGain).connect(this.masterGain);
    noise.start(t);
    noise.stop(t + 2.5);

    // Layer 2: Tonal rumble body (lower frequency for deeper tone)
    const osc = this.ctx.createOscillator();
    const oGain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.linearRampToValueAtTime(80, t + 0.18);
    osc.frequency.linearRampToValueAtTime(60, t + 0.54);
    oGain.gain.setValueAtTime(0.08, t);
    oGain.gain.linearRampToValueAtTime(0, t + 1.0);
    osc.connect(oGain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 1.0);
  }

  /** Low square wave thud — turret shot. */
  playHostileGun(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.13);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.07);
    gain.gain.linearRampToValueAtTime(0, t + 0.13);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Double pip at 807Hz — fuel/pod pickup. */
  playCollect(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 807;
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.setValueAtTime(0, t + 0.01);
    gain.gain.setValueAtTime(0.3, t + 0.03);
    gain.gain.setValueAtTime(0, t + 0.04);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Sharp 453Hz beep — planet destruction countdown tick. */
  playCountdown(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 453;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** 751Hz square wave with long sustain decay — level complete. */
  playEnterOrbit(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 751;
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.2);
    gain.gain.linearRampToValueAtTime(0, t + 2.4);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 2.5);
  }

  /** Start continuous engine noise (blocked during explosion timer). */
  startEngine(): void {
    if (this.soundTimer === 0) this.engine.start();
  }

  stopEngine(): void {
    this.engine.stop();
  }

  get engineActive(): boolean {
    return this.engine.active;
  }

  /** Start continuous shield/tractor hum. */
  startShield(): void {
    this.shield.start();
  }

  stopShield(): void {
    this.shield.stop();
  }

  get shieldActive(): boolean {
    return this.shield.active;
  }

  /** Stop all continuous sounds (for level transitions, death, etc). */
  stopAll(): void {
    this.engine.stop();
    this.shield.stop();
    this.soundTimer = 0;
  }
}
