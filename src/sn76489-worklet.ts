// SN76489 AudioWorklet — authentic BBC Micro sound chip emulator
// driven by MOS envelope processor, running entirely in the audio thread.

// AudioWorklet global scope declarations
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

// ─── Volume table: 4-bit attenuation, -2dB per step, /4 for per-channel mix ───
const volumeTable = new Float32Array(16);
{
  let f = 1.0;
  for (let i = 0; i < 15; i++) {
    volumeTable[i] = f / 4;
    f *= Math.pow(10, -0.1); // -2dB
  }
  volumeTable[15] = 0;
}

// MOS channel → SN76489 chip channel mapping
// MOS ch0 = noise → chip ch3, MOS ch1 → chip ch2, ch2 → chip ch1, ch3 → chip ch0
const mosToChipChannel = [3, 2, 1, 0];

// ─── Pitch lookup tables (from BBC MOS 1.20) ───
const pitchLookupTableLow = [
  0xf0, 0xb7, 0x82, 0x4f, 0x20, 0xf3, 0xc8, 0xa0, 0x7b, 0x57, 0x35, 0x16,
];
const pitchLookupTableHigh = [
  0xe7, 0xd7, 0xcb, 0xc3, 0xb7, 0xaa, 0xa2, 0x9a, 0x92, 0x8a, 0x82, 0x7a,
];
const channelPitchOffset = [0, 0, 1, 2];

// ─── SN76489 chip constants ───
const LFSR_INITIAL = 0x4000;
const LATCH_FLAG = 0x80;
const CHANNEL_MASK = 0x03;
const VOLUME_MASK = 0x0F;
const NOISE_CONTROL_MASK = 0x07;
const PERIOD_LOW_MASK = 0x0F;
const PERIOD_HIGH_MASK = 0x3F;
const PERIOD_UPPER_BITS = 0x3F0;
const NOISE_PERIOD_512 = 0x10;
const NOISE_PERIOD_1024 = 0x20;
const NOISE_PERIOD_2048 = 0x40;
const WHITE_NOISE_FLAG = 0x04;
const PERIOD_10BIT_MASK = 0x3FF;

// ─── MOS envelope processor constants ───
const MOS_VOLUME_SILENT = 0xC7;
const MOS_VOLUME_LOUDEST = 0x3F;
const MOS_VOLUME_CLAMP_SILENT = 0xC0;
const MOS_NO_ENVELOPE = 0xFF;
const MOS_BUFFER_MASK = 0x0F;
const MOS_OCCUPIED_FLAG = 0x80;
const MOS_HOLD_FLAG = 0x04;
const MOS_COUNTDOWN_INITIAL = 5;
const MOS_CHANNEL_FLUSH_FLAG = 0x10;
const MOS_VOLUME_OFFSET = 0x40;
const MOS_VOLUME_CHANGE_MASK = 0xF8;
const MOS_CHIP_VOLUME_XOR = 0x0F;
const MOS_STEP_LENGTH_MASK = 0x7F;
const MOS_AUTO_REPEAT_FLAG = 0x80;
const MOS_VOLUME_OFF = 0x0F;
const MOS_PERIOD_HIGH_MASK = 0x03;
const PITCH_SECTION_COMPLETE = 3;
const RELEASE_COMPLETE = 4;

// ─── SN76489 chip emulator ───
class SN76489 {
  private period = new Uint16Array(4);   // 10-bit tone period or 3-bit noise control
  private counter = new Float64Array(4); // fractional counters for sample-rate conversion
  private polarity = [1, 1, 1, 1];      // +1 or -1
  private vol = new Float32Array(4);     // looked-up volume per channel
  private lfsr = LFSR_INITIAL;           // 15-bit linear feedback shift register
  private latchedReg = 0;               // last latched register index (0-7)
  private noisePeriod = NOISE_PERIOD_512; // effective noise period

  constructor() {
    for (let i = 0; i < 4; i++) this.vol[i] = 0; // all silent (vol table[15]=0 by default)
  }

  write(value: number): void {
    if (value & LATCH_FLAG) {
      // Latch byte: 1 CC R DDDD
      const channel = (value >> 5) & CHANNEL_MASK;
      const isVolume = (value >> 4) & 1;
      this.latchedReg = (channel << 1) | isVolume;

      if (isVolume) {
        this.vol[channel] = volumeTable[value & VOLUME_MASK];
      } else if (channel === 3) {
        // Noise control register — low 3 bits; reset LFSR only when value changes
        const newCtrl = value & NOISE_CONTROL_MASK;
        if (newCtrl !== this.period[3]) {
          this.lfsr = LFSR_INITIAL;
        }
        this.period[3] = newCtrl;
        this.updateNoisePeriod();
      } else {
        // Tone: set low 4 bits, keep upper 6
        this.period[channel] = (this.period[channel] & PERIOD_UPPER_BITS) | (value & PERIOD_LOW_MASK);
      }
    } else {
      // Data byte: 0 _ DDDDDD
      const reg = this.latchedReg;
      const channel = reg >> 1;
      const isVolume = reg & 1;

      if (isVolume) {
        this.vol[channel] = volumeTable[value & VOLUME_MASK];
      } else if (channel === 3) {
        const newCtrl = value & NOISE_CONTROL_MASK;
        if (newCtrl !== this.period[3]) {
          this.lfsr = LFSR_INITIAL;
        }
        this.period[3] = newCtrl;
        this.updateNoisePeriod();
      } else {
        // Tone: set upper 6 bits, keep low 4
        this.period[channel] = ((value & PERIOD_HIGH_MASK) << 4) | (this.period[channel] & PERIOD_LOW_MASK);
      }
    }
  }

  private updateNoisePeriod(): void {
    const ctrl = this.period[3] & CHANNEL_MASK;
    if (ctrl === 0) this.noisePeriod = NOISE_PERIOD_512;
    else if (ctrl === 1) this.noisePeriod = NOISE_PERIOD_1024;
    else if (ctrl === 2) this.noisePeriod = NOISE_PERIOD_2048;
    else this.noisePeriod = 0; // sentinel: use tone channel 2's period
  }

  generate(out: Float32Array, offset: number, length: number, sampleRate: number): void {
    const step = 250000.0 / sampleRate; // chip clocks per audio sample

    for (let i = 0; i < length; i++) {
      let sample = 0;

      // Tone channels 0–2
      for (let ch = 0; ch < 3; ch++) {
        this.counter[ch] -= step;
        if (this.counter[ch] <= 0) {
          const p = this.period[ch] || 1024; // period 0 acts as 1024
          this.counter[ch] += p;
          if (this.counter[ch] <= 0) this.counter[ch] = p; // prevent runaway
          this.polarity[ch] = -this.polarity[ch];
        }
        sample += this.polarity[ch] * this.vol[ch];
      }

      // Noise channel 3
      this.counter[3] -= step;
      if (this.counter[3] <= 0) {
        const np = this.noisePeriod === 0
          ? (this.period[2] || 1024)
          : this.noisePeriod;
        this.counter[3] += np;
        if (this.counter[3] <= 0) this.counter[3] = np;

        // Advance LFSR
        const isWhite = (this.period[3] & WHITE_NOISE_FLAG) !== 0;
        if (isWhite) {
          const feedback = ((this.lfsr & 1) ^ ((this.lfsr >> 1) & 1)) << 14;
          this.lfsr = (this.lfsr >> 1) | feedback;
        } else {
          this.lfsr >>= 1;
          if (this.lfsr === 0) this.lfsr = LFSR_INITIAL;
        }
      }
      // Noise output: bit 0 determines polarity
      sample += ((this.lfsr & 1) ? 1 : -1) * this.vol[3];

      out[offset + i] = sample;
    }
  }
}

// ─── MOS sound channel state ───
class MOSSoundChannel {
  occupancy = 0;
  volume = MOS_VOLUME_SILENT;
  phaseCounter = 0;
  basePitch = 0;
  section = MOS_NO_ENVELOPE;
  sectionCountdownProgress = 0;
  duration = 0;
  countdown20Hz = MOS_COUNTDOWN_INITIAL;
  envelopeOffset = MOS_NO_ENVELOPE;
  stepCountdownProgress = 0;
  pitch = 0;
  pitchOffset = 0;

  // Circular buffer: 16 bytes, holds up to 5 sounds × 3 bytes
  buffer = new Uint8Array(16);
  bufReadPos = 0;
  bufWritePos = 0;
  bufCount = 0;

  reset(): void {
    this.occupancy = 0;
    this.volume = MOS_VOLUME_SILENT;
    this.phaseCounter = 0;
    this.basePitch = 0;
    this.section = MOS_NO_ENVELOPE;
    this.sectionCountdownProgress = 0;
    this.duration = 0;
    this.countdown20Hz = MOS_COUNTDOWN_INITIAL;
    this.envelopeOffset = MOS_NO_ENVELOPE;
    this.stepCountdownProgress = 0;
    this.pitch = 0;
    this.pitchOffset = 0;
    this.bufReadPos = 0;
    this.bufWritePos = 0;
    this.bufCount = 0;
  }

  pushByte(b: number): void {
    this.buffer[this.bufWritePos] = b;
    this.bufWritePos = (this.bufWritePos + 1) & MOS_BUFFER_MASK;
  }

  popByte(): number {
    const b = this.buffer[this.bufReadPos];
    this.bufReadPos = (this.bufReadPos + 1) & MOS_BUFFER_MASK;
    return b;
  }

  hasSound(): boolean {
    return this.bufCount > 0;
  }

  flushBuffer(): void {
    this.bufReadPos = 0;
    this.bufWritePos = 0;
    this.bufCount = 0;
  }
}

// ─── MOS Sound System ───
class MOSSoundSystem {
  private channels: MOSSoundChannel[];
  private envelopeBuffer = new Uint8Array(64); // 4 envelopes × 16 bytes
  private chip: SN76489;

  constructor(chip: SN76489) {
    this.chip = chip;
    this.channels = [
      new MOSSoundChannel(),
      new MOSSoundChannel(),
      new MOSSoundChannel(),
      new MOSSoundChannel(),
    ];
  }

  osword7(channel: number, amplitude: number, pitch: number, duration: number): void {
    // Decode channel field
    const chIndex = channel & CHANNEL_MASK;             // low 2 bits = channel 0-3
    const flush = (channel & MOS_CHANNEL_FLUSH_FLAG) !== 0; // bit 4 = flush

    const ch = this.channels[chIndex];

    if (flush) {
      ch.flushBuffer();
      ch.bufCount = 0;
      ch.duration = 0; // interrupt current sound so new one starts next tick
    }

    // Encode 3-byte buffer entry
    // Byte 0: bit7=volume mode, bits3-6=envelope/volume, bit2=hold, bits0-1=sync
    let byte0 = 0;
    if (amplitude > 0) {
      // Positive = envelope number (1-4)
      // bits 3-6 = (envelope - 1), shifted to form offset
      byte0 = ((amplitude - 1) & VOLUME_MASK) << 3;
    } else {
      // Negative = direct volume
      byte0 = LATCH_FLAG | (((-amplitude) & VOLUME_MASK) << 3);
    }

    ch.pushByte(byte0);
    ch.pushByte(pitch & 0xff);
    ch.pushByte(duration & 0xff);
    ch.bufCount++;
    ch.occupancy = MOS_OCCUPIED_FLAG;

    // If channel had no sound playing (duration was 0 and not occupied before),
    // trigger immediately by zeroing duration so the tick picks it up
    if (ch.duration === 0 && ch.phaseCounter >= RELEASE_COMPLETE) {
      // Will be picked up on next tick
    }
  }

  osword8(envNumber: number, data: number[]): void {
    // Store envelope bytes 1-13 at the correct offset
    const base = (envNumber - 1) * 16;
    for (let i = 1; i <= 13; i++) {
      this.envelopeBuffer[base + i] = data[i] & 0xff;
    }
    this.envelopeBuffer[base + 14] = 0;
    this.envelopeBuffer[base + 15] = 0;
  }

  silenceAll(): void {
    for (let ch = 0; ch < 4; ch++) {
      this.channels[ch].reset();
      // Set chip volume to 15 (off)
      this.chip.write(LATCH_FLAG | (mosToChipChannel[ch] << 5) | 0x10 | MOS_VOLUME_OFF);
    }
  }

  tick(): void {
    // Process channels 3 down to 0 (matching MOS order)
    for (let chIdx = 3; chIdx >= 0; chIdx--) {
      const ch = this.channels[chIdx];
      if (!(ch.occupancy & MOS_OCCUPIED_FLAG)) continue; // not occupied

      // Duration handling
      if (ch.duration === 0) {
        // No active sound duration — try to read next from buffer
        this.checkForNextSound(chIdx);
      } else if (ch.duration !== MOS_NO_ENVELOPE) {
        // Active sound, not infinite — count down
        ch.countdown20Hz--;
        if (ch.countdown20Hz === 0) {
          ch.countdown20Hz = MOS_COUNTDOWN_INITIAL; // reset to give 20Hz rate
          ch.duration--;
          if (ch.duration === 0) {
            this.checkForNextSound(chIdx);
          }
        }
      }

      // If channel was silenced by checkForNextSound (release complete), skip
      if (!(ch.occupancy & MOS_OCCUPIED_FLAG)) continue;

      // ENVELOPE UPDATE — runs every centisecond, gated by step length
      if (ch.stepCountdownProgress !== 0) {
        ch.stepCountdownProgress--;
        if (ch.stepCountdownProgress !== 0) continue;
      }

      if (ch.envelopeOffset === MOS_NO_ENVELOPE) continue; // no envelope

      const envBase = ch.envelopeOffset;

      // Reload step countdown
      ch.stepCountdownProgress = this.envelopeBuffer[envBase + 1] & MOS_STEP_LENGTH_MASK;

      // === AMPLITUDE ENVELOPE ===
      if (ch.phaseCounter < RELEASE_COMPLETE) {
        // Get target and step for current phase
        // Phase 0=attack, 1=decay, 2=sustain, 3=release
        let targetRaw: number;
        if (ch.phaseCounter < 2) {
          targetRaw = this.envelopeBuffer[envBase + 12 + ch.phaseCounter];
        } else {
          // Sustain and release: target is 0 (silence)
          targetRaw = 0;
        }
        const targetAmplitude = (targetRaw - MOS_VOLUME_LOUDEST) & 0xff;

        const currentStep = this.envelopeBuffer[envBase + 8 + ch.phaseCounter];

        // Apply amplitude step with 6502 overflow semantics
        const oldVolume = ch.volume;
        let newVolume = (ch.volume + currentStep) & 0xff;

        // Overflow detection: ((old ^ result) & (step ^ result) & 0x80)
        const overflow = ((oldVolume ^ newVolume) & (currentStep ^ newVolume) & 0x80) !== 0;

        if (overflow) {
          if (newVolume & LATCH_FLAG) {
            // Result was negative (high bit set) — clamp to loudest
            newVolume = MOS_VOLUME_LOUDEST;
          } else {
            // Result was positive — clamp to silent
            newVolume = MOS_VOLUME_CLAMP_SILENT;
          }
        }

        // Additional clamping: bits 6 and 7 must be equal
        // The MOS uses ROL A which puts bit 7 into carry, then BCC/BCS to decide.
        // bit7=0 means we're in $40-$7F (overshot past $3F loud end) → clamp to $3F
        // bit7=1 means we're in $80-$BF (overshot past $C0 silent end) → clamp to $C0
        const bit6 = (newVolume >> 6) & 1;
        const bit7 = (newVolume >> 7) & 1;
        if (bit6 !== bit7) {
          if (newVolume & LATCH_FLAG) {
            newVolume = MOS_VOLUME_CLAMP_SILENT;
          } else {
            newVolume = MOS_VOLUME_LOUDEST;
          }
        }

        ch.volume = newVolume;

        // Check if we've reached the target
        const distance = (ch.volume - targetAmplitude) & 0xff;
        const stepMinus1 = (currentStep - 1) & 0xff;
        if (!((distance ^ stepMinus1) & 0x80)) {
          // Reached or passed target
          ch.volume = targetAmplitude;
          ch.phaseCounter++;
        }

        // Only write to chip if volume actually changed (upper 5 bits differ)
        if ((oldVolume ^ ch.volume) & MOS_VOLUME_CHANGE_MASK) {
          const chipVol = (((ch.volume - MOS_VOLUME_OFFSET) & 0xff) >> 3) ^ MOS_CHIP_VOLUME_XOR;
          this.chip.write(LATCH_FLAG | (mosToChipChannel[chIdx] << 5) | 0x10 | (chipVol & VOLUME_MASK));
        }
      }

      // === PITCH ENVELOPE ===
      if (ch.section === PITCH_SECTION_COMPLETE) continue; // all sections complete
      if (ch.sectionCountdownProgress !== 0) {
        // Countdown not finished — apply pitch change
        ch.sectionCountdownProgress--;
        const pitchChange = this.signedByte(this.envelopeBuffer[envBase + 2 + ch.section]);
        ch.pitchOffset = (ch.pitchOffset + pitchChange) & 0xff;
        const actualPitch = (ch.basePitch + ch.pitchOffset) & 0xff;
        this.setPitch(chIdx, actualPitch);
        continue;
      }

      // Advance to next pitch section
      ch.section = (ch.section + 1) & 0xff;
      if (ch.section === PITCH_SECTION_COMPLETE) {
        // Check auto-repeat: bit 7 of envelope byte 1 CLEAR = repeat
        if (!(this.envelopeBuffer[envBase + 1] & MOS_AUTO_REPEAT_FLAG)) {
          ch.section = 0;
          ch.pitchOffset = 0;
        } else {
          continue;
        }
      }

      // Load steps for new section
      ch.sectionCountdownProgress = this.envelopeBuffer[envBase + 5 + ch.section];
      if (ch.sectionCountdownProgress === 0) continue;

      // Apply pitch change for this step
      ch.sectionCountdownProgress--;
      const pitchChange = this.signedByte(this.envelopeBuffer[envBase + 2 + ch.section]);
      ch.pitchOffset = (ch.pitchOffset + pitchChange) & 0xff;
      const actualPitch = (ch.basePitch + ch.pitchOffset) & 0xff;
      this.setPitch(chIdx, actualPitch);
    }
  }

  private signedByte(b: number): number {
    return b > 127 ? b - 256 : b;
  }

  private checkForNextSound(chIdx: number): void {
    const ch = this.channels[chIdx];

    // Enter release phase if not already in release-complete
    if (ch.phaseCounter < RELEASE_COMPLETE) {
      if (ch.phaseCounter !== RELEASE_COMPLETE) {
        ch.phaseCounter = PITCH_SECTION_COMPLETE; // enter release
      }
    }

    if (!ch.hasSound()) {
      // No more sounds — silence the channel if:
      // - release phase completed (phaseCounter >= 4), OR
      // - no envelope to drive the release (direct-volume sounds)
      if (ch.phaseCounter >= RELEASE_COMPLETE || ch.envelopeOffset === MOS_NO_ENVELOPE) {
        ch.occupancy = 0;
        this.chip.write(LATCH_FLAG | (mosToChipChannel[chIdx] << 5) | 0x10 | MOS_VOLUME_OFF); // volume off
      }
      return;
    }

    // Read new sound from buffer
    ch.bufCount--;
    this.readNewSound(chIdx);
  }

  private readNewSound(chIdx: number): void {
    const ch = this.channels[chIdx];
    const byte0 = ch.popByte();

    const holdBit = byte0 & MOS_HOLD_FLAG;

    if (holdBit) {
      // Hold: keep current envelope running, just update duration
      if (ch.envelopeOffset === MOS_NO_ENVELOPE) {
        // No envelope — silence
        this.chip.write(LATCH_FLAG | (mosToChipChannel[chIdx] << 5) | 0x10 | MOS_VOLUME_OFF);
      }
      ch.popByte(); // discard pitch
      ch.duration = ch.popByte();
      return;
    }

    // Extract envelope/volume info
    const isDirectVolume = (byte0 & LATCH_FLAG) !== 0;
    const envVolBits = (byte0 >> 3) & VOLUME_MASK;

    if (isDirectVolume) {
      // Direct volume: convert to internal format
      // envVolBits is the volume level (0=silent, 15=loudest)
      // Internal volume: -15 → $3F, -1 → $CF, 0 → $C7
      // Formula: volume = (15 - level) * 8 + 7 ... but mapped to MOS internal
      // Actually: SOUND amplitude of -(envVolBits) maps to internal volume
      // The amplitude field was negated during osword7 encoding, so envVolBits = |amplitude|
      // MOS internal: for amplitude -N, volume = ($3F - (15-N)*8) but let me use the table approach
      // From spec: -15 → $3F, -14 → $37, ..., -8 → $07, -7 → $FF, ..., -1 → $CF, 0 → $C7
      // Pattern: volume = ($3F - (15 - envVolBits) * 8) & 0xFF, but that gives:
      //   15: $3F, 14: $37, 13: $2F, ..., 8: $07, 7: $FF, ..., 1: $CF, 0: $C7
      // Simplified: volume = (envVolBits * 8 - 1 - 0x78) & 0xFF = (envVolBits * 8 + 0x87) & 0xFF
      // Let me verify: 15*8+0x87 = 120+135 = 255 & 0xFF = 0xFF? No.
      // Better: $C7 + envVolBits * 8, masked: (0xC7 + envVolBits * 8) & 0xFF
      //   0: $C7, 1: $CF, 2: $D7, ..., 7: $FF, 8: $07, 9: $0F, ..., 15: $3F ✓
      ch.volume = (MOS_VOLUME_SILENT + envVolBits * 8) & 0xff;
      ch.envelopeOffset = MOS_NO_ENVELOPE;

      // Write volume to chip immediately
      const chipVol = (((ch.volume - MOS_VOLUME_OFFSET) & 0xff) >> 3) ^ MOS_CHIP_VOLUME_XOR;
      this.chip.write(LATCH_FLAG | (mosToChipChannel[chIdx] << 5) | 0x10 | (chipVol & VOLUME_MASK));
    } else {
      // Envelope: envVolBits = (envelope_number - 1), offset = envVolBits * 16
      ch.envelopeOffset = envVolBits * 16;

      // Set initial volume to silent
      ch.volume = MOS_VOLUME_SILENT;
      const chipVol = (((ch.volume - MOS_VOLUME_OFFSET) & 0xff) >> 3) ^ MOS_CHIP_VOLUME_XOR;
      this.chip.write(LATCH_FLAG | (mosToChipChannel[chIdx] << 5) | 0x10 | (chipVol & VOLUME_MASK));
    }

    // Initialize envelope state
    ch.countdown20Hz = MOS_COUNTDOWN_INITIAL;
    ch.stepCountdownProgress = 1; // trigger update on next tick
    ch.sectionCountdownProgress = 0;
    ch.phaseCounter = 0; // start at attack
    ch.pitchOffset = 0;
    ch.section = MOS_NO_ENVELOPE; // will increment to 0 on first pitch tick

    // Read pitch and duration
    ch.basePitch = ch.popByte();
    ch.pitch = ch.basePitch;
    ch.duration = ch.popByte();
    this.setPitch(chIdx, ch.basePitch);
  }

  private setPitch(chIdx: number, pitchByte: number): void {
    const chipCh = mosToChipChannel[chIdx];
    if (chIdx === 0) {
      // Noise channel: write low 3 bits directly as noise control register
      this.chip.write(LATCH_FLAG | (chipCh << 5) | (pitchByte & NOISE_CONTROL_MASK));
    } else {
      // Tone channel: convert pitch byte to 10-bit period
      const period = this.pitchToPeriod(pitchByte, chIdx);
      // Write latch (low 4 bits) then data (high 6 bits)
      this.chip.write(LATCH_FLAG | (chipCh << 5) | (period & PERIOD_LOW_MASK));
      this.chip.write((period >> 4) & PERIOD_HIGH_MASK);
    }
  }

  private pitchToPeriod(pitch: number, mosChannel: number): number {
    const fractional = pitch & 3;
    let semitoneIndex = pitch >> 2;

    let octave = 0;
    while (semitoneIndex >= 12) {
      octave++;
      semitoneIndex -= 12;
    }

    let periodLow = pitchLookupTableLow[semitoneIndex];
    let periodHigh = pitchLookupTableHigh[semitoneIndex] & MOS_PERIOD_HIGH_MASK;
    const fractionalStep = pitchLookupTableHigh[semitoneIndex] >> 4;

    // Adjust for quarter-semitones
    for (let i = 0; i < fractional; i++) {
      periodLow -= fractionalStep;
      if (periodLow < 0) {
        periodLow += 256;
        periodHigh--;
        if (periodHigh < 0) periodHigh += 4; // wrap 2-bit high byte
      }
    }

    // Combine and shift right for octave
    let period = ((periodHigh & MOS_PERIOD_HIGH_MASK) << 8) | (periodLow & 0xff);
    period >>= octave;

    // Add per-channel offset
    period += channelPitchOffset[mosChannel];

    return period & PERIOD_10BIT_MASK; // 10-bit
  }
}

// ─── SN76489 AudioWorklet Processor ───
class SN76489Processor extends AudioWorkletProcessor {
  private chip = new SN76489();
  private mos = new MOSSoundSystem(this.chip);
  private tickCounter = 0;
  private samplesPerTick = 0;

  constructor() {
    super();
    this.samplesPerTick = sampleRate / 100; // 100Hz tick rate
    this.tickCounter = 0;

    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'osword7':
          this.mos.osword7(msg.channel, msg.amplitude, msg.pitch, msg.duration);
          break;
        case 'osword8':
          this.mos.osword8(msg.envNumber, msg.data);
          break;
        case 'silenceAll':
          this.mos.silenceAll();
          break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], _params: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const buf = output[0];
    const len = buf.length;
    let pos = 0;

    while (pos < len) {
      // How many samples until the next 100Hz tick?
      const untilTick = Math.ceil(this.samplesPerTick - this.tickCounter);
      const chunk = Math.min(untilTick, len - pos);

      // Generate audio for this chunk
      this.chip.generate(buf, pos, chunk, sampleRate);

      this.tickCounter += chunk;
      pos += chunk;

      // Fire MOS tick
      if (this.tickCounter >= this.samplesPerTick) {
        this.tickCounter -= this.samplesPerTick;
        this.mos.tick();
      }
    }

    // Copy mono to all output channels
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(buf);
    }

    return true;
  }
}

registerProcessor('sn76489-processor', SN76489Processor);
