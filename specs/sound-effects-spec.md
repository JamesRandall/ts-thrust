# Thrust Sound Effects — Web Audio API Implementation Spec

Derived from the BBC Micro 6502 assembly. The original uses the SN76489 sound chip via OSWORD 7 SOUND commands with 4 ENVELOPE definitions. The SN76489 generates **square waves** for tone channels and **white/periodic noise** for the noise channel.

## BBC Micro Sound Architecture

- **Channel 0**: Noise generator (white noise or periodic)
- **Channels 1–3**: Square wave tone generators
- **4 envelopes**: Control pitch sweep and amplitude over time per sound
- **Pitch units**: Quarter-semitones. `freq = 440 × 2^((pitch - 148) / 48)`
- **Amplitude**: 0–126 scale (maps to 0.0–1.0 gain)

## Web Audio Approach

Use `OscillatorNode` with `type: 'square'` for tone channels. Use a `BufferSourceNode` with generated white noise for the noise channel. Use `GainNode` for amplitude envelopes. Use `frequency.setValueAtTime` / `linearRampToValueAtTime` for pitch sweeps.

The BBC Micro's square wave has a distinctive hard, buzzy quality — using Web Audio's `'square'` oscillator type is the correct match.

---

## Sound Definitions

### 1. Player Gun (`ownGun`)

A downward pitch-sweeping square wave — the classic 8-bit "pew" laser.

**Trigger**: Once per shot fired.

```
Waveform:  square
Start:     165 Hz
End:       ~52 Hz (pitch floor, reached around 200ms)
Sweep:     Fast exponential-feeling drop — steep at first, then flattens
Duration:  ~360ms (amplitude envelope controls length)
Amplitude: Instant attack to full, linear decay to 0 over 360ms
```

**Pitch sweep detail** (from Envelope 1, step = 20ms):
- Phase 1: −5 quarter-semitones/step × 2 steps (40ms) — fast drop
- Phase 2: −3 quarter-semitones/step × 3 steps (60ms) — medium drop
- Phase 3: −5 quarter-semitones/step × 50 steps (1000ms) — continues dropping but amplitude is gone by ~360ms

For Web Audio, schedule a smooth exponential ramp from 165Hz to 52Hz over 350ms. The stepped nature is inaudible.

```typescript
function playOwnGun(ctx: AudioContext, time: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(165, time);
  osc.frequency.exponentialRampToValueAtTime(52, time + 0.35);
  gain.gain.setValueAtTime(0.4, time);
  gain.gain.linearRampToValueAtTime(0, time + 0.36);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.4);
}
```

---

### 2. Explosion (`explosion`)

Two simultaneous layers: a noise burst (dominant) and a quiet tonal component.

**Trigger**: Once per destruction event (ship, gun, fuel pod, etc).

**Layer 1 — Noise burst** (Channel 0, Envelope 3):
```
Waveform:  White noise
Duration:  ~2.4s total, but perceptually significant for ~1s
Amplitude: Instant attack to full, slow linear decay to 0 over ~2.4s
```

**Layer 2 — Tonal rumble** (Channel 1, Envelope 2):
```
Waveform:  Square wave at ~453Hz
Duration:  1.0s
Amplitude: Very quiet (envelope 2 barely produces audible output)
Pitch:     Slight wobble: drops 9 quarter-semitones over 180ms, holds, rises back
```

The noise burst is the main sound. The tonal layer adds subtle body — it can be omitted for simplicity with minimal perceptual loss.

The explosion also sets `sound_timer = 31`, which blocks the engine sound for 31 frames (~0.6s). This prevents engine noise from masking the explosion.

```typescript
function playExplosion(ctx: AudioContext, time: number): void {
  // Layer 1: White noise burst
  const bufferSize = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, time);
  noiseGain.gain.linearRampToValueAtTime(0.35, time + 0.2);  // decay phase
  noiseGain.gain.linearRampToValueAtTime(0, time + 2.4);      // sustain fade
  noise.connect(noiseGain).connect(ctx.destination);
  noise.start(time);
  noise.stop(time + 2.5);

  // Layer 2: Subtle tonal body (optional)
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(453, time);
  osc.frequency.linearRampToValueAtTime(420, time + 0.18);
  osc.frequency.linearRampToValueAtTime(453, time + 0.54);
  oscGain.gain.setValueAtTime(0.03, time);   // very quiet
  oscGain.gain.linearRampToValueAtTime(0, time + 1.0);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 1.0);
}
```

---

### 3. Hostile Gun (`hostileGun`)

A low-pitched square wave with rapid downward sweep and fast decay — a menacing "thud".

**Trigger**: Once per turret shot.

```
Waveform:  Square wave
Start:     80 Hz
End:       ~52 Hz (reaches pitch floor around 300ms)
Sweep:     −1 quarter-semitone per 10ms step, 54 total steps
Duration:  ~130ms (amplitude envelope controls length)
Amplitude: Fast attack (30ms to peak), fast decay to 0 by ~130ms
```

**Amplitude detail** (Envelope 4, step = 10ms):
- Attack: +50/step to target 110 → 3 steps (30ms)
- Decay: −12/step to target 70 → 4 steps (40ms)
- Sustain: −12/step to 0 → 6 steps (60ms)

```typescript
function playHostileGun(ctx: AudioContext, time: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(80, time);
  osc.frequency.exponentialRampToValueAtTime(52, time + 0.13);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.35, time + 0.03);   // fast attack
  gain.gain.linearRampToValueAtTime(0.22, time + 0.07);   // decay
  gain.gain.linearRampToValueAtTime(0, time + 0.13);      // sustain fade
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.15);
}
```

---

### 4. Engine Thrust (`engine`)

Short bursts of white noise retriggered every frame while the thrust key is held.

**Trigger**: Called every game tick while thrusting (and `sound_timer == 0`).

In the original, this is a 30ms noise burst re-queued each frame, creating a continuous hiss. For Web Audio, use a **persistent noise source** that is enabled/disabled rather than retriggering individual bursts.

```
Waveform:  White noise (noise type 5 = medium frequency white noise)
Volume:    −10 of −15 scale ≈ 0.67 of max ≈ gain 0.25
Duration:  Continuous while thrusting
```

When the shield/tractor is active instead of thrust, the original switches to noise type 2 (periodic, low frequency) — a buzzy hum. This can be approximated with a very low frequency square wave (~30–50Hz) at low volume.

```typescript
class EngineSound {
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    // Pre-generate looping noise buffer (1 second)
    const bufferSize = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(ctx.destination);
  }

  start(): void {
    if (this.source) return;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.noiseBuffer;
    this.source.loop = true;
    this.source.connect(this.gain);
    this.source.start();
    this.gain.gain.setTargetAtTime(0.25, this.ctx.currentTime, 0.02);
  }

  stop(): void {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const src = this.source;
    this.source = null;
    if (src) {
      setTimeout(() => src.stop(), 100);
    }
  }
}
```

---

### 5. Collect (Fuel / Pod Pickup) (`collect`)

A rapid three-part "pip-silence-pip" sequence — a brief high-pitched tick.

**Trigger**: Each time a fuel unit is absorbed or pod is collected.

The original calls: `collect_1` → `collect_2` → `collect_1`
- `collect_1`: Channel 2, volume −15 (full), pitch 190 (~807Hz), duration 10ms
- `collect_2`: Channel 2, volume 0 (silent), pitch 190, duration 20ms

This creates: beep → silence → beep. A quick double-tick.

```typescript
function playCollect(ctx: AudioContext, time: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 807;
  // Pip - silence - pip pattern
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.setValueAtTime(0, time + 0.01);      // silence after first pip
  gain.gain.setValueAtTime(0.3, time + 0.03);     // second pip
  gain.gain.setValueAtTime(0, time + 0.04);       // end
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.05);
}
```

---

### 6. Countdown Beep (`countdown`)

A sharp beep played once per second during the planet destruction countdown (9→0).

**Trigger**: Once per countdown tick. Preceded by a `collect_2` (silence command to reset channel).

```
Waveform:  Square wave
Frequency: 453 Hz
Volume:    Full (−15 of −15)
Duration:  ~10ms (very short, sharp)
```

```typescript
function playCountdown(ctx: AudioContext, time: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 453;
  gain.gain.setValueAtTime(0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.1);
}
```

---

### 7. Enter Orbit / Level Complete (`enterOrbit`)

A high-pitched tone with a sustaining decay — a triumphant "ding".

**Trigger**: Once when the ship enters orbit to complete the level.

```
Waveform:  Square wave
Frequency: 751 Hz (constant, no pitch sweep — Envelope 3 has zero pitch change)
Amplitude: Envelope 3 — instant attack to full, decay to ~87% over 160ms,
           then slow linear fade over ~2.2s
Duration:  ~2.4s
```

```typescript
function playEnterOrbit(ctx: AudioContext, time: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 751;
  gain.gain.setValueAtTime(0.4, time);
  gain.gain.linearRampToValueAtTime(0.35, time + 0.2);   // decay to ~87%
  gain.gain.linearRampToValueAtTime(0, time + 2.4);       // slow fade
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 2.5);
}
```

---

## Sound Priority & Blocking

The original uses a `sound_timer` mechanism to prevent sounds from clashing:

- **Explosion** sets `sound_timer = 31` (31 frames ≈ 0.62s at 50fps)
- **Engine sound** is blocked while `sound_timer > 0`
- `sound_timer` decrements once per frame
- Other sounds (guns, collect) play regardless of the timer

For Web Audio, this is less critical since we have unlimited polyphony, but you may want to suppress the engine noise briefly after explosions for authenticity.

## Volume Balancing

Suggested relative gains (adjust to taste):

| Sound | Gain | Notes |
|-------|------|-------|
| Own gun | 0.40 | Prominent, player feedback |
| Explosion (noise) | 0.50 | Loudest event |
| Explosion (tone) | 0.03 | Barely audible body |
| Hostile gun | 0.35 | Noticeable but not dominant |
| Engine | 0.25 | Background continuous |
| Collect | 0.30 | Clear tick |
| Countdown | 0.35 | Urgent, attention-getting |
| Enter orbit | 0.40 | Celebratory |

## Complete Class Interface

```typescript
class ThrustSounds {
  private ctx: AudioContext;
  private engine: EngineSound;
  private soundTimer: number = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.engine = new EngineSound(this.ctx);
  }

  /** Call once on first user interaction to unlock audio */
  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Call every game tick to decrement the explosion blocking timer */
  tick(): void {
    if (this.soundTimer > 0) this.soundTimer--;
  }

  playOwnGun(): void { /* as above */ }
  playExplosion(): void { this.soundTimer = 31; /* as above */ }
  playHostileGun(): void { /* as above */ }
  playCollect(): void { /* as above */ }
  playCountdown(): void { /* as above */ }
  playEnterOrbit(): void { /* as above */ }

  startEngine(): void {
    if (this.soundTimer === 0) this.engine.start();
  }

  stopEngine(): void {
    this.engine.stop();
  }
}
```

## Shield/Tractor Beam Sound

When the shield or tractor beam is active, the engine uses noise type 2 (periodic, low) instead of type 5 (white noise, medium). This produces a lower-frequency buzzy hum rather than a hiss. Approximate with:

```typescript
function startShieldHum(ctx: AudioContext): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 40;  // low periodic buzz
  gain.gain.value = 0.15;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  return osc;  // caller stops when shield deactivated
}
```

The original toggles this every other frame (`vsync_count AND $02`), creating a characteristic on-off pulsing at 12.5Hz. For authenticity, modulate the gain at this rate:

```typescript
// Pulsing shield hum (12.5Hz on/off)
const lfo = ctx.createOscillator();
const lfoGain = ctx.createGain();
lfo.type = 'square';
lfo.frequency.value = 12.5;
lfoGain.gain.value = 0.15;
lfo.connect(lfoGain);
lfoGain.connect(shieldGain.gain);  // modulate the shield sound's volume
lfo.start();
```
