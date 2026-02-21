# Thrust: Authentic Sound System — Implementation Reference

This document describes everything needed to reproduce the sound of the original BBC Micro version of Thrust authentically: the SN76489 sound chip, the BBC MOS envelope system that drives it, and all of the game's sound definitions.

The implementation is three layers: a TypeScript SN76489 emulator, a BBC MOS sound envelope processor that drives it, and a game sound interface that issues OSWORD 7 calls.

## Layer 1: SN76489 Sound Chip

### Overview

The SN76489 is a 4-channel sound generator:
- Channels 0–2: Square wave tone generators
- Channel 3: Noise generator

Each channel has independent 4-bit volume attenuation.

### Clock

The SN76489 in the BBC Micro is clocked at **4 MHz**, with an internal divide-by-16, giving a **250 kHz** effective tone clock. (Note: jsbeeb models this as 4MHz/8 with half-wave counting — the result is identical.)

```
frequency = 250000 / (2 × period)
```

Where `period` is a 10-bit value (1–1023). Period 0 acts as period 1024.

### Tone Channels (0–2)

Each has a 10-bit period register. A counter decrements at 250kHz. When it reaches zero, it reloads from the period register and the output polarity toggles. This produces a square wave.

### Noise Channel (3)

A 3-bit control register selects mode and shift rate:

| Bit 2 | Bits 1-0 | Shift Rate |
|---|---|---|
| 0 (periodic) | 00 | clock/512 (period $10) |
| 0 (periodic) | 01 | clock/1024 (period $20) |
| 0 (periodic) | 10 | clock/2048 (period $40) |
| 0 (periodic) | 11 | Use tone channel 2's period |
| 1 (white) | 00-11 | Same as above |

The noise generator uses a 15-bit LFSR, initialised to `1 << 14`:
- **White noise**: feedback = bit 0 XOR bit 1, fed back to bit 14
- **Periodic noise**: shift right, if LFSR becomes 0 reset to `1 << 14`

Output is bit 0 of the LFSR. The LFSR advances each time the noise counter reaches zero.

### Volume Attenuation

4-bit value per channel (0–15):

| Value | Effect |
|---|---|
| 0 | Full volume |
| 1–14 | -2 dB per step |
| 15 | OFF (silence) |

```typescript
const volumeTable = new Float32Array(16);
let f = 1.0;
for (let i = 0; i < 15; i++) {
    volumeTable[i] = f / 4;  // /4 bakes in per-channel mix level
    f *= Math.pow(10, -0.1);  // -2dB per step
}
volumeTable[15] = 0;
```

### Register Write Protocol

Single-byte commands:

**Latch byte** (bit 7 = 1): `1 CC R DDDD`
- CC = channel (0–3)
- R = 0 for frequency, 1 for volume
- DDDD = 4 bits of data

**Data byte** (bit 7 = 0): `0 _ DDDDDD`
- 6 bits of data (upper bits of frequency)

For frequency: 10-bit value = `(data_byte & 0x3F) << 4 | (latch_byte & 0x0F)`

For volume: only the latch byte is used (4 bits).

For noise: only the latch byte is used (lower 3 bits = control).

Writing to the noise register resets the LFSR to `1 << 14`.

### Per-Channel Pitch Offsets

The MOS adds a small offset to the 10-bit pitch value depending on the channel, to avoid phase cancellation when multiple channels play the same note:

| Channel | Offset |
|---|---|
| 0 (noise) | 0 |
| 1 | 0 |
| 2 | +1 |
| 3 | +2 |

## Layer 2: BBC MOS Sound Envelope Processor

This is the critical layer. Extracted directly from the annotated BBC MOS 1.20 disassembly (os120_acme.a). All behaviour described here is the exact MOS implementation.

### Timing

The MOS sound interrupt runs at **100 Hz** (every centisecond). This is the master clock for all sound processing. Duration timing uses a sub-counter that counts down from 5 at 100Hz, giving **20 Hz** duration ticks (each duration unit = 50ms).

### Per-Channel State

Each of the 4 channels maintains:

| Variable | Size | Description |
|---|---|---|
| occupancy | 1 | Bit 7 set if sound is playing |
| volume | 1 | Current volume ($3F=loud to $C0=silent) |
| phaseCounter | 1 | ADSR phase: 0=attack, 1=decay, 2=sustain, 3=release, 4=release complete |
| basePitch | 1 | Pitch at start of sound (from SOUND command) |
| section | 1 | Current pitch envelope section (0–2), starts at $FF |
| sectionCountdownProgress | 1 | Steps remaining in current pitch section |
| duration | 1 | Remaining duration in 20ths of a second |
| countdown20Hz | 1 | Sub-counter: counts 5→0 at 100Hz to give 20Hz |
| envelopeOffset | 1 | Offset into envelope buffer ($FF = no envelope) |
| stepCountdownProgress | 1 | Steps until next envelope update (step length countdown) |
| syncFlag | 1 | Synchronisation flag |
| pitch | 1 | Current pitch value (base + offset) |
| pitchOffset | 1 | Accumulated pitch offset from envelope |

### Envelope Storage

4 envelopes stored at `$08C0`, 16 bytes each (envelope number × 16). The OSWORD 8 call stores bytes 1–13 of the parameter block into the buffer in **reverse order** (bytes stored at offset 13 down to 1), with bytes 14 and 15 zero-padded.

The envelope buffer layout per envelope (16 bytes, indexed 0–15):

| Offset | OSWORD 8 Byte | Name |
|---|---|---|
| 0 | — | Unused (zero) |
| 1 | 1 | Step length (bit 7 = auto-repeat pitch) |
| 2 | 2 | Pitch change per step, section 1 (signed) |
| 3 | 3 | Pitch change per step, section 2 (signed) |
| 4 | 4 | Pitch change per step, section 3 (signed) |
| 5 | 5 | Number of steps in pitch section 1 |
| 6 | 6 | Number of steps in pitch section 2 |
| 7 | 7 | Number of steps in pitch section 3 |
| 8 | 8 | Amplitude change per step: attack (AA) |
| 9 | 9 | Amplitude change per step: decay (AD) |
| 10 | 10 | Amplitude change per step: sustain (AS) |
| 11 | 11 | Amplitude change per step: release (AR) |
| 12 | 12 | Target amplitude at end of attack (ALA) |
| 13 | 13 | Target amplitude at end of decay (ALD) |
| 14 | — | Zero padding |
| 15 | — | Zero padding |

Wait — the MOS stores them reversed. Let me re-examine. The copy loop is:

```
A = (envelope_number - 1) * 16 | 15    // start at top of 16-byte slot
X = A (destination offset, counts DOWN)
Y = 16 (source offset, counts DOWN from 16 to 1)
loop:
    if Y >= 14: store 0
    else: store osword_block[Y]
    X--; Y--
    until Y == 0
```

So destination offset X goes from `(env*16+15)` down to `(env*16+0)`. Source Y goes from 16 down to 1. The mapping is:

| Buffer offset (X counting down) | Source Y | What's stored |
|---|---|---|
| env*16 + 15 | 16 | 0 (padding, Y≥14) |
| env*16 + 14 | 15 | 0 (padding, Y≥14) |
| env*16 + 13 | 13 | byte 13: decay target (ALD) |
| env*16 + 12 | 12 | byte 12: attack target (ALA) |
| env*16 + 11 | 11 | byte 11: release step (AR) |
| env*16 + 10 | 10 | byte 10: sustain step (AS) |
| env*16 + 9 | 9 | byte 9: decay step (AD) |
| env*16 + 8 | 8 | byte 8: attack step (AA) |
| env*16 + 7 | 7 | byte 7: pitch section 3 steps (PN3) |
| env*16 + 6 | 6 | byte 6: pitch section 2 steps (PN2) |
| env*16 + 5 | 5 | byte 5: pitch section 1 steps (PN1) |
| env*16 + 4 | 4 | byte 4: pitch change 3 (PI3) |
| env*16 + 3 | 3 | byte 3: pitch change 2 (PI2) |
| env*16 + 2 | 2 | byte 2: pitch change 1 (PI1) |
| env*16 + 1 | 1 | byte 1: step length / repeat flag |
| env*16 + 0 | — | Not written (loop ends at Y=0) |

So the buffer IS in forward order, byte 1 at offset 1, etc. The envelope number byte (byte 0) is NOT stored (the offset encodes which envelope it is).

Corrected envelope buffer layout (relative to envelope base offset):

| Offset | Description |
|---|---|
| 0 | (not written, leftover from previous data) |
| 1 | Step length. Bits 0–6 = centiseconds per step. Bit 7: 0 = auto-repeat pitch, 1 = don't repeat. |
| 2 | Pitch change per step, section 1 (signed byte) |
| 3 | Pitch change per step, section 2 (signed byte) |
| 4 | Pitch change per step, section 3 (signed byte) |
| 5 | Number of steps in pitch section 1 |
| 6 | Number of steps in pitch section 2 |
| 7 | Number of steps in pitch section 3 |
| 8 | Amplitude step: attack (signed) |
| 9 | Amplitude step: decay (signed) |
| 10 | Amplitude step: sustain (signed) |
| 11 | Amplitude step: release (signed) |
| 12 | Target amplitude: end of attack (0–126) |
| 13 | Target amplitude: end of decay (0–126) |
| 14–15 | Zero padding |

### MOS Volume Encoding

The MOS uses a custom volume encoding internally. SOUND amplitude values map to internal volume:

| SOUND amplitude | Internal volume byte | Meaning |
|---|---|---|
| -15 | $3F | Loudest |
| -14 | $37 | |
| ... | decrements by $08 | |
| -8 | $07 | |
| -7 | $FF | (wraps) |
| -6 | $F7 | |
| ... | | |
| -1 | $CF | |
| 0 | $C7 | Silent |

The conversion to SN76489 4-bit volume is:
```
chip_volume = ((internal_volume - $40) >> 3) XOR $0F
```

Effectively: `chip_volume = 15 - ((internal_volume - $40) / 8)`, clamped. The `& $F8` mask in the update code means volume only changes when the upper 5 bits change — giving 16 effective volume levels matching the chip's 4-bit range.

Envelope target amplitudes (bytes 12–13) are stored with a bias: the MOS subtracts $3F before comparing, so a target of 126 ($7E) becomes $3F (loudest), and a target of 0 becomes -$3F ($C1, silent).

### The 100Hz Tick: `processSoundInterrupt`

This runs every centisecond. For each channel (X = 7 down to 4, i.e. channels 3 down to 0):

```
PROCESS_CHANNEL(X):
    if channel not occupied: skip
    if buffer empty: check_for_next_sound
    if duration > 0: continue_existing_sound

    check_for_next_sound:
        if phase != 4 (release complete):
            phase = 3 (enter release)
        read next sound from buffer queue if available
        (see "Reading New Sounds" below)

    continue_existing_sound:
        if duration == $FF: skip duration decrement (infinite)
        countdown20Hz -= 1
        if countdown20Hz != 0: skip duration decrement
        countdown20Hz = 5   // reset (gives 20Hz rate)
        duration -= 1
        if duration == 0: check_for_next_sound

    // ENVELOPE UPDATE (runs every centisecond, gated by step length)
    if stepCountdownProgress != 0:
        stepCountdownProgress -= 1
        if stepCountdownProgress != 0: skip to next channel
    
    if envelopeOffset == $FF: skip (no envelope)

    // Reload step countdown from envelope
    stepCountdownProgress = envelope[1] & 0x7F   // step length

    // === AMPLITUDE ENVELOPE ===
    if phaseCounter == 4: skip amplitude (release complete)

    // Get target and step for current phase
    targetAmplitude = envelope[12 + phaseCounter] - $3F
    currentStep = envelope[8 + phaseCounter]

    // Apply amplitude step
    oldVolume = volume
    newVolume = volume + currentStep

    // Clamp on overflow
    if overflow:
        if newVolume was negative: newVolume = $3F (loudest)
        else: newVolume = $C0 (silent)

    // Additional clamping: bits 6 and 7 must be equal
    if bit6 != bit7 of newVolume:
        if carry clear: newVolume = $3F
        else: newVolume = $C0

    volume = newVolume

    // Check if we've reached the target
    distance = volume - targetAmplitude
    if (distance XOR (currentStep - 1)) has bit 7 set:
        // Still moving toward target, continue
    else:
        // Reached or passed target
        volume = targetAmplitude
        phaseCounter += 1    // advance to next ADSR phase

    // Only write to chip if volume actually changed (upper 5 bits)
    if (oldVolume XOR volume) & $F8 != 0:
        write volume to SN76489

    // === PITCH ENVELOPE ===
    if section == 3: skip (all pitch sections complete)
    if sectionCountdownProgress != 0: goto countdown_not_finished

    // Advance to next pitch section
    section += 1
    if section == 3:
        if envelope[1] bit 7 clear: // auto-repeat
            section = 0
            pitchOffset = 0
        else:
            skip to next channel
    
    // Load steps for new section
    sectionCountdownProgress = envelope[5 + section]
    if sectionCountdownProgress == 0: skip

    countdown_not_finished:
    sectionCountdownProgress -= 1

    // Apply pitch change for current section
    pitchChange = envelope[2 + section]   // signed byte
    pitchOffset += pitchChange
    actualPitch = basePitch + pitchOffset
    set_pitch(actualPitch)
```

### Reading a New Sound from the Buffer

Each sound in the buffer is 3 bytes (packed by OSWORD 7):

| Byte | Contents |
|---|---|
| 0 | Bit 7: 0=envelope, 1=direct volume. Bits 3–6: envelope-1 or volume. Bit 2: hold. Bits 0–1: sync. |
| 1 | Pitch |
| 2 | Duration |

```
READ_NEW_SOUND:
    read byte 0 from buffer

    if hold bit set:
        if envelope active: keep current envelope running
        else: silence channel
        read and discard pitch byte
        read duration byte
        set duration
        return

    isolate bits 3-7, shift left
    if bit 7 was set (direct volume):
        convert to internal volume format
        set volume
        envelopeOffset = $FF (no envelope)
    else:
        envelopeOffset = value (this IS the envelope offset: (env_num-1)*16)

    countdown20Hz = 5
    stepCountdownProgress = 1   // trigger envelope update on next tick
    sectionCountdownProgress = 0
    phaseCounter = 0    // start at attack phase
    pitchOffset = 0
    section = $FF       // will be incremented to 0 on first pitch update

    read pitch byte → basePitch
    read duration byte
    set_pitch(basePitch)
    set duration
```

### Pitch to SN76489 Period Conversion

The MOS converts the 8-bit pitch (0–255) to a 10-bit SN76489 period:

```
PITCH_TO_PERIOD(pitch):
    fractional = pitch & 3          // quarter-semitone (0-3)
    semitone_index = pitch >> 2     // semitone count (0-63)

    // Find octave and note within octave
    octave = 0
    while semitone_index >= 12:
        octave += 1
        semitone_index -= 12

    // Look up base period for note within octave (from tables)
    periodLow = pitchLookupTableLow[semitone_index]
    periodHigh = pitchLookupTableHigh[semitone_index] & 0x03
    fractionalStep = pitchLookupTableHigh[semitone_index] >> 4

    // Adjust for quarter-semitones
    for i = 0 to fractional-1:
        periodLow -= fractionalStep   // with borrow into periodHigh

    // Shift right for octave (halve period per octave)
    period = (periodHigh << 8 | periodLow) >> octave

    // Add per-channel offset
    period += channelPitchOffset[channel]

    return period  // 10-bit value
```

#### Pitch Lookup Tables

```typescript
// Low byte of 10-bit period for each semitone (B, C, C#, D, D#, E, F, F#, G, G#, A, A#)
const pitchLookupTableLow = [
    0xF0, 0xB7, 0x82, 0x4F, 0x20, 0xF3, 0xC8, 0xA0, 0x7B, 0x57, 0x35, 0x16
];

// Bits 0-1: high byte of 10-bit period
// Bits 4-7: fractional step (amount to subtract per quarter-semitone)
const pitchLookupTableHigh = [
    0xE7, 0xD7, 0xCB, 0xC3, 0xB7, 0xAA, 0xA2, 0x9A, 0x92, 0x8A, 0x82, 0x7A
];

// Per-channel pitch offsets (avoid phase cancellation)
const channelPitchOffset = [0, 0, 1, 2];  // channels 0-3
```

### Sound Buffer Queue

Each channel has a 16-byte circular buffer holding up to 5 sounds (3 bytes each, plus overhead). When `channel` byte bit 4 is set in OSWORD 7, the buffer is flushed before adding the new sound. When bit 4 is clear (e.g. channel=$02), the sound is queued.

## Layer 3: Game Sound Definitions

### Envelope Definitions (OSWORD 8)

```typescript
// Raw bytes as defined in the game ROM (14 bytes each, byte 0 = envelope number)
const envelopes = {
    1: [0x01, 0x02, 0xFB, 0xFD, 0xFB, 0x02, 0x03, 0x32, 0x7E, 0xF9, 0xF9, 0xF4, 0x7E, 0x00],
    2: [0x02, 0x02, 0xFF, 0x00, 0x01, 0x09, 0x09, 0x09, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00],
    3: [0x03, 0x04, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x7E, 0xFC, 0xFE, 0xFC, 0x7E, 0x6E],
    4: [0x04, 0x01, 0xFF, 0xFF, 0xFF, 0x12, 0x12, 0x12, 0x32, 0xF4, 0xF4, 0xF4, 0x6E, 0x46],
};
```

#### Envelope 1: Explosion / Gun / Enter Orbit
- Step length: 2 centiseconds (50 updates/sec). No auto-repeat (bit 7 = 0).
- Pitch: falls by 5, then 3, then 5 per step over 2+3+50 steps. Auto-repeats.
- Amplitude: attack to 126 instantly (+126/step), decay to 0 (-7/step), sustain -7/step, release -12/step.
- **Character**: Loud zap with falling pitch.

#### Envelope 2: Collect Jingle / Countdown Beep
- Step length: 2 centiseconds. No auto-repeat.
- Pitch: -1 for 9 steps, 0 for 9 steps, +1 for 9 steps. Auto-repeats.
- Amplitude: attack to 1 (0/step = instant), decay to 0 (0/step), sustain 0/step, release +1/step.
- **Character**: Very quiet steady tone with subtle pitch wobble.

#### Envelope 3: Explosion Noise Body
- Step length: 4 centiseconds (25 updates/sec). No auto-repeat.
- Pitch: 0 change across all sections (1+1+1 steps). Auto-repeats.
- Amplitude: attack to 126 (+126/step), decay to 110 (-4/step), sustain -2/step, release -4/step.
- **Character**: Loud sustained rumble at fixed pitch. Slow envelope makes it last.

#### Envelope 4: Hostile Gun / Engine
- Step length: 1 centisecond (100 updates/sec — fastest possible). No auto-repeat.
- Pitch: -1 per step across all three sections (18+18+18 = 54 steps). Auto-repeats.
- Amplitude: attack to 110 (+50/step), decay to 70 (-12/step), sustain -12/step, release -12/step.
- **Character**: Medium-loud falling-pitch buzz, fades quickly.

### Sound Parameter Blocks (OSWORD 7)

Format: `channel(2 bytes LE), amplitude(2 bytes LE), pitch(2 bytes LE), duration(2 bytes LE)`

```typescript
const sounds = {
    own_gun:      { channel: 0x0012, amplitude: 1,   pitch: 0x50, duration: 2  },
    explosion_1:  { channel: 0x0011, amplitude: 2,   pitch: 0x96, duration: 100 },
    explosion_2:  { channel: 0x0010, amplitude: 3,   pitch: 0x07, duration: 100 },
    hostile_gun:  { channel: 0x0013, amplitude: 4,   pitch: 0x1E, duration: 20 },
    collect_1:    { channel: 0x0002, amplitude: -15,  pitch: 0xBE, duration: 1  },
    collect_2:    { channel: 0x0002, amplitude: 0,    pitch: 0xBE, duration: 2  },
    engine:       { channel: 0x0010, amplitude: -10,  pitch: 0x05, duration: 3  },
    countdown:    { channel: 0x0002, amplitude: -15,  pitch: 0x96, duration: 1  },
    enter_orbit:  { channel: 0x0012, amplitude: 3,    pitch: 0xB9, duration: 1  },
};
```

#### Channel field decoding:
- `$0010` = noise channel, flush
- `$0011` = tone channel 1, flush
- `$0012` = tone channel 2, flush
- `$0013` = tone channel 3, flush
- `$0002` = tone channel 2, NO flush (queued)

#### Amplitude field:
- Positive (1–4) = use envelope number
- Negative = direct volume (negate to get volume: -15 = loudest, -1 = quietest, 0 = silent)

#### Noise pitch byte:
- `$05` = white noise (bit 2 set), medium shift rate (bits 0-1 = 01): clock/1024
- `$07` = white noise, shift rate = tone channel 2's frequency (bits 0-1 = 11)
- `$02` = periodic noise (bit 2 clear), medium shift rate (bits 0-1 = 10): clock/2048

### Sound Events

| Event | Function | Sounds Played |
|---|---|---|
| Player fires | `own_gun_sound` | own_gun (env 1, ch2, flush) |
| Object destroyed | `explosion_sound` | explosion_1 (env 2, ch1, flush) + explosion_2 (env 3, noise, flush) |
| Engine (thrust) | `run_engine` | engine (noise, flush, pitch=$05) |
| Engine (shield) | `run_engine_ext` | engine (noise, flush, pitch=$02) |
| Hostile gun | `hostile_gun_sound` | hostile_gun (env 4, ch3, flush) |
| Fuel/pod collect | `collect_pod_fuel_sound` | collect_1 + collect_2 + collect_1 (all ch2, QUEUED) |
| Countdown tick | inline | collect_1 (ch2, queued) |
| Extra life | `countdown_sound` | collect_2 + countdown (both ch2, queued) |
| Enter orbit | `enter_orbit_sound` | enter_orbit (env 3, ch2, flush) |

### Engine Pitch Switching

The engine sound pitch byte is the ONLY runtime-modified sound parameter:
- `$05` when thrusting (white noise, clock/1024)
- `$02` when shield active (periodic noise, clock/2048)

The shield call goes through `run_engine_ext` which skips the `shield_tractor_pressed` check and uses the current pitch value. After both paths, pitch is reset to `$02`.

### Sound Timer (Priority System)

```typescript
// Game-level priority: sound_timer blocks engine while explosions play
let soundTimer = 0;

function explosionSound() {
    soundTimer = 0x1F;  // 31 game ticks
    playSound('explosion_1');
    playSound('explosion_2');
}

function runEngine(isShield: boolean) {
    if (!isShield && shieldPressed) return;
    
    enginePitch = isShield ? 0x02 : 0x05;
    
    if (soundTimer !== 0) return;  // blocked by explosion
    playSound('engine');  // with modified pitch
    
    enginePitch = 0x02;  // reset to shield pitch
}

function tick() {
    if (soundTimer > 0) soundTimer--;
}
```

## Implementation Architecture

### Component 1: SN76489 (~100 lines)

```typescript
class SN76489 {
    private registers = new Uint16Array(4);  // 10-bit period (channels 0-2), 3-bit control (channel 3)
    private counters = new Float64Array(4);
    private polarity = [false, false, false, false];
    private volume = new Float32Array(4);    // using volumeTable lookup
    private lfsr = 0x4000;
    private latchedRegister = 0;

    write(value: number): void;              // process command byte
    generate(out: Float32Array, offset: number, length: number): void;
}
```

Run in an **AudioWorklet** for glitch-free output. The worklet receives register write messages from the main thread.

### Component 2: MOS Envelope Processor (~300 lines)

```typescript
class MOSSoundChannel {
    // All the per-channel state variables listed above
    occupancy: number;
    volume: number;
    phaseCounter: number;
    basePitch: number;
    section: number;
    sectionCountdownProgress: number;
    duration: number;
    countdown20Hz: number;
    envelopeOffset: number;
    stepCountdownProgress: number;
    pitch: number;
    pitchOffset: number;
    
    // Circular buffer for queued sounds
    buffer: Uint8Array;
}

class MOSSoundSystem {
    private channels: MOSSoundChannel[4];
    private envelopeBuffer: Uint8Array;  // 64 bytes (4 × 16)
    private chip: SN76489;

    osword7(params: Uint8Array): void;   // SOUND command
    osword8(params: Uint8Array): void;   // ENVELOPE definition
    tick(): void;                        // called at 100Hz
}
```

The `tick()` method implements `processSoundInterrupt` exactly as described above. It generates SN76489 register writes and posts them to the AudioWorklet.

### Component 3: Game Sound Interface (~50 lines)

```typescript
class ThrustSound {
    private mos: MOSSoundSystem;
    private soundTimer: number = 0;

    init(): void;          // define 4 envelopes via osword8
    explosionSound(): void;
    ownGunSound(): void;
    hostileGunSound(): void;
    runEngine(isShield: boolean): void;
    collectPodFuelSound(): void;
    countdownSound(): void;
    enterOrbitSound(): void;
    tick(): void;          // game tick: decrement soundTimer
}
```

### Audio Pipeline

```
Game event → ThrustSound → MOSSoundSystem.osword7()
                                   |
                           100Hz timer (setInterval or synced to game loop)
                                   |
                           MOSSoundSystem.tick()
                                   |
                           SN76489.write() commands
                                   |
                           AudioWorklet message
                                   |
                           SN76489.generate() → speaker
```

### Critical Implementation Notes

1. **The 100Hz tick must be accurate.** Use a timer or sync to the game's 50Hz tick (call the MOS tick twice per game tick). Drift here will change envelope timing and make sounds wrong.

2. **The amplitude clamping is fiddly.** The MOS uses signed arithmetic with overflow detection on a custom volume scale. Follow the exact algorithm from `processSoundInterrupt` — don't try to simplify it. The `ROL/EOR` sequence for detecting bits 6 and 7 equality is critical. **Implement this section byte-for-byte from the algorithm above rather than trying to reason about what it "should" do mathematically.** The MOS uses 6502 overflow flag semantics on a non-standard volume range ($3F=loud, $C0=silent) that wraps around in unintuitive ways. Attempting to rewrite this as clean signed arithmetic will produce subtly wrong envelope shapes. Match the exact sequence: add step, check overflow, clamp, check bit 6/7 equality, clamp again, compare against target with EOR sign check.

3. **The `& $F8` mask on volume comparison** means the chip volume only updates when the internal volume crosses a boundary. This is correct — the SN76489 only has 16 volume levels, so sub-level changes are invisible.

4. **Pitch section starts at $FF.** When a new sound starts, `section` is set to $FF. On the first pitch envelope tick, it increments to 0 and loads section 0's step count. This is a one-tick delay before pitch envelope starts — don't skip it.

5. **Duration of $FF means infinite.** The MOS never decrements it. Used for sounds that should play until explicitly stopped.

6. **Noise channel pitch byte maps directly to the SN76489 noise control register** (lower 3 bits only). No pitch-to-period conversion.

7. **Auto-repeat pitch envelope**: when bit 7 of envelope byte 1 is CLEAR, the pitch envelope repeats. When SET, it doesn't. This is counterintuitive — 0 means repeat.

8. **The jsbeeb soundchip.js** you already have is a correct SN76489 implementation. You can port it directly to TypeScript or use it as reference. The key difference: it uses divide-by-8 with half-wave counting rather than divide-by-16 with full-wave counting. Both produce identical output.
