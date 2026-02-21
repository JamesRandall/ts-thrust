// Thrust Sound System — authentic SN76489 via AudioWorklet
// Sends OSWORD 7/8 commands to the worklet which runs the full
// BBC MOS envelope processor + chip emulator.

// Envelope definitions (OSWORD 8) — 14 bytes each, byte 0 = envelope number
const envelopes: Record<number, number[]> = {
  1: [0x01, 0x02, 0xfb, 0xfd, 0xfb, 0x02, 0x03, 0x32, 0x7e, 0xf9, 0xf9, 0xf4, 0x7e, 0x00],
  2: [0x02, 0x02, 0xff, 0x00, 0x01, 0x09, 0x09, 0x09, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00],
  3: [0x03, 0x04, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x7e, 0xfc, 0xfe, 0xfc, 0x7e, 0x6e],
  4: [0x04, 0x01, 0xff, 0xff, 0xff, 0x12, 0x12, 0x12, 0x32, 0xf4, 0xf4, 0xf4, 0x6e, 0x46],
};

// OSWORD 7 channel IDs — low 2 bits = MOS channel, bit 4 = flush flag
const CHANNEL_NOISE_FLUSH = 0x0010;
const CHANNEL_TONE1_FLUSH = 0x0011;
const CHANNEL_TONE2_FLUSH = 0x0012;
const CHANNEL_TONE3_FLUSH = 0x0013;
const CHANNEL_TONE2_QUEUED = 0x0002;

// Engine pitch overrides (noise control register values)
const NOISE_PERIODIC_2048 = 0x02;
const NOISE_WHITE_1024 = 0x05;

// Explosion sound suppression timer (31 ticks)
const EXPLOSION_SOUND_DURATION = 0x1F;

// Sound parameter definitions (OSWORD 7)
const sounds = {
  own_gun:     { channel: CHANNEL_TONE2_FLUSH, amplitude: 1,   pitch: 0x50, duration: 2   },
  explosion_1: { channel: CHANNEL_TONE1_FLUSH, amplitude: 2,   pitch: 0x96, duration: 100 },
  explosion_2: { channel: CHANNEL_NOISE_FLUSH, amplitude: 3,   pitch: 0x07, duration: 100 },
  hostile_gun: { channel: CHANNEL_TONE3_FLUSH, amplitude: 4,   pitch: 0x1e, duration: 20  },
  collect_1:   { channel: CHANNEL_TONE2_QUEUED, amplitude: -15, pitch: 0xbe, duration: 1   },
  collect_2:   { channel: CHANNEL_TONE2_QUEUED, amplitude: 0,   pitch: 0xbe, duration: 2   },
  engine:      { channel: CHANNEL_NOISE_FLUSH, amplitude: -10, pitch: NOISE_WHITE_1024, duration: 3   },
  countdown:   { channel: CHANNEL_TONE2_QUEUED, amplitude: -15, pitch: 0x96, duration: 1   },
  enter_orbit: { channel: CHANNEL_TONE2_FLUSH, amplitude: 3,   pitch: 0xb9, duration: 1   },
} as const;

type SoundName = keyof typeof sounds;

export class ThrustSounds {
  private ctx!: AudioContext;
  private node!: AudioWorkletNode;
  private soundTimer = 0;
  private initialized = false;

  private constructor() {}

  static create(): ThrustSounds {
    return new ThrustSounds();
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.ctx = new AudioContext();

    const workletUrl = new URL('./sn76489-worklet.ts', import.meta.url);
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.node = new AudioWorkletNode(this.ctx, 'sn76489-processor');
    this.node.connect(this.ctx.destination);

    // Define all 4 envelopes
    for (const [num, data] of Object.entries(envelopes)) {
      this.node.port.postMessage({ type: 'osword8', envNumber: Number(num), data });
    }
  }

  async resume(): Promise<void> {
    await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  tick(): void {
    if (this.soundTimer > 0) this.soundTimer--;
  }

  private sendSound(name: SoundName, pitchOverride?: number): void {
    if (!this.node) return;
    const s = sounds[name];
    this.node.port.postMessage({
      type: 'osword7',
      channel: s.channel,
      amplitude: s.amplitude,
      pitch: pitchOverride !== undefined ? pitchOverride : s.pitch,
      duration: s.duration,
    });
  }

  playOwnGun(): void {
    this.sendSound('own_gun');
  }

  playExplosion(): void {
    this.soundTimer = EXPLOSION_SOUND_DURATION;
    this.sendSound('explosion_1');
    this.sendSound('explosion_2');
  }

  playHostileGun(): void {
    this.sendSound('hostile_gun');
  }

  playCollect(): void {
    this.sendSound('collect_1');
    this.sendSound('collect_2');
    this.sendSound('collect_1');
  }

  playCountdown(): void {
    this.sendSound('countdown');
  }

  playEnterOrbit(): void {
    this.sendSound('enter_orbit');
  }

  runEngine(isShield: boolean): void {
    if (this.soundTimer !== 0) return;
    this.sendSound('engine', isShield ? NOISE_PERIODIC_2048 : NOISE_WHITE_1024);
  }

  stopAll(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'silenceAll' });
    this.soundTimer = 0;
  }
}
