# Turret Firing System — Reference from BBC Micro *Thrust* (1986)

Extracted from the annotated 6502 disassembly of *Thrust* by Jeremy C. Smith (disassembly by Kieran HJ Connell, 2016). This describes the hostile turret AI and bullet system for implementation in a TypeScript game engine.

## Overview

Turrets are static map objects that fire bullets at probabilistic intervals when visible on screen. Each turret has a configured base firing direction and spread cone. Firing probability increases with each level and is further punished if the player destroyed the planet on the previous level. A generator mechanic temporarily disables all turrets when hit, creating a risk/reward loop.

Turrets do not aim at the player. They fire within a randomised cone around their configured direction. The threat comes from volume and positioning, not precision tracking.

## Turret Types

There are four turret orientations, each a distinct object type:

| Type ID | Name | Bullet X Offset | Bullet Y Offset |
|---------|------|-----------------|-----------------|
| `0` | gun_up_right | +4 | 0 |
| `1` | gun_down_right | +4 | +8 |
| `2` | gun_up_left | +1 | 0 |
| `3` | gun_down_left | +1 | +8 |

The offsets position the bullet spawn point relative to the turret's world position (roughly centring it on the sprite). The orientation name describes the visual direction but the actual firing arc is entirely determined by the per-turret gun param (see below).

## Firing Preconditions

Every game tick, each turret is evaluated. All five conditions must pass for a shot to be fired. If any fails, the turret is skipped for that tick.

```typescript
function canTurretFire(
  turret: Turret,
  generatorRechargeCounter: number,
  planetCountdownActive: boolean,
  isVisible: boolean,
  shootProbability: number
): boolean {
  // 1. Must be a gun object (type 0-3), not fuel/pod/generator/switch
  if (turret.type > 3) return false;

  // 2. Generator must not be recharging (ceasefire while stunned)
  if (generatorRechargeCounter > 0) return false;

  // 3. Planet escape countdown must not be active
  if (planetCountdownActive) return false;

  // 4. Turret must be visible on screen
  if (!isVisible) return false;

  // 5. Random probability check
  if (randomByte() >= shootProbability) return false;

  return true;
}
```

The random check means each visible turret independently rolls to fire every tick. With multiple turrets on screen, the effective fire rate scales with the number of visible guns.

## Difficulty Scaling

The `shootProbability` value controls how aggressive turrets are. It's a threshold compared against a random byte (0–255), so it represents a `probability / 256` chance per tick per visible turret.

### Level Progression

```typescript
interface DifficultyState {
  levelHostileGunProbability: number;       // increments each level, starts at 1
  planetDestroyedModifier: number;          // +8 if planet was destroyed last level
  hostileGunShootProbability: number;       // final value used in firing check
}

function advanceLevel(state: DifficultyState, destroyedPlanet: boolean): void {
  // Increment base probability, cap at 35
  state.levelHostileGunProbability = Math.min(
    state.levelHostileGunProbability + 1,
    0x23  // 35
  );

  // Add planet destruction penalty
  state.hostileGunShootProbability =
    state.levelHostileGunProbability + state.planetDestroyedModifier;

  // Reset modifier (penalty applied once, then cleared)
  state.planetDestroyedModifier = 0;

  // If planet was destroyed THIS level, set modifier for NEXT level
  if (destroyedPlanet) {
    state.planetDestroyedModifier = 0x08;  // 8
  }
}

function initNewGame(state: DifficultyState): void {
  state.levelHostileGunProbability = 1;
  state.planetDestroyedModifier = 0;
  state.hostileGunShootProbability = 0x02;  // ~0.8% per tick
}
```

### Probability Progression Table

| Level | Base Probability | With Planet Penalty | Chance Per Tick |
|-------|-----------------|--------------------|-----------------| 
| 1 | 2 | 10 | 0.8% / 3.9% |
| 5 | 6 | 14 | 2.3% / 5.5% |
| 10 | 11 | 19 | 4.3% / 7.4% |
| 20 | 21 | 29 | 8.2% / 11.3% |
| 34+ | 35 (cap) | 43 | 13.7% / 16.8% |

## Aiming — The Gun Param System

Each turret has a per-level **gun param byte** that encodes its firing direction and accuracy. This allows level designers to place tight snipers and wild scattershot turrets on the same map.

### Encoding

```
gun_param byte: 000BBBSS

  SS  (bits 0-1): Spread index — looked up in spread table
  BBB (bits 2-4): Base angle offset (already shifted left by 2, so value is 0, 4, 8, 12, 16, 20, 24, 28)
  bits 5-7:       Unused (masked off)
```

### Spread Table

The 2-bit spread index maps to a bitmask that controls how many bits of randomness affect the angle:

| Index (bits 0–1) | Spread Mask | Effective Arc |
|-------------------|-------------|---------------|
| `0` | `$01` | ±1 angle step — sniper |
| `1` | `$03` | ±3 angle steps — focused |
| `2` | `$07` | ±7 angle steps — moderate |
| `3` | `$0F` | ±15 angle steps — wild scatter |

### Angle Calculation

The firing angle is computed from the gun param plus randomness, selecting from a 32-entry angle table (0–31, wrapping):

```typescript
const SPREAD_TABLE = [0x01, 0x03, 0x07, 0x0F] as const;

interface GunParam {
  baseAngleOffset: number;  // bits 2-4, value 0-28 in steps of 4
  spreadMask: number;       // looked up from bits 0-1
}

function decodeGunParam(paramByte: number): GunParam {
  const spreadIndex = paramByte & 0x03;
  const baseAngleOffset = paramByte & 0x1C;  // bits 2-4 (pre-shifted)
  return {
    baseAngleOffset,
    spreadMask: SPREAD_TABLE[spreadIndex],
  };
}

function calculateFiringAngle(param: GunParam, rng: () => number): number {
  const rndA = rng();  // 0-255
  const rndB = rng();  // 0-255 (second call to RNG)

  const jitter = rndA & 0x03;                        // 0-3 fine jitter
  const spread = rndB & param.spreadMask;             // 0 to spreadMask
  const angle = (spread + param.baseAngleOffset + jitter) & 0x1F;  // wrap to 0-31

  return angle;
}
```

### Angle Table (32 Entries)

The 32 angles are evenly distributed around a full circle. Index 0 is straight up, index 8 is right, index 16 is down, index 24 is left. Each entry provides a Q7.8 fixed-point velocity vector (integer + fraction).

```typescript
// Velocity lookup tables — 32 angles, full circle
// Format: [fraction, integer] pairs for Q7.8 fixed-point
// Integer part is signed: 0xFF = -1, 0xFE = -2, etc.

const ANGLE_TO_Y_FRAC = [
  0x80, 0x8D, 0xB1, 0xEC, 0x3C, 0x9D, 0x0C, 0x84,
  0x00, 0x7C, 0xF4, 0x63, 0xC4, 0x14, 0x4F, 0x73,
  0x80, 0x73, 0x4F, 0x14, 0xC4, 0x63, 0xF4, 0x7C,
  0x00, 0x84, 0x0C, 0x9D, 0x3C, 0xEC, 0xB1, 0x8D,
];

const ANGLE_TO_Y_INT = [
  0xFD, 0xFD, 0xFD, 0xFD, 0xFE, 0xFE, 0xFF, 0xFF,
  0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x02,
  0x02, 0x02, 0x02, 0x02, 0x01, 0x01, 0x00, 0x00,
  0x00, 0xFF, 0xFF, 0xFE, 0xFE, 0xFD, 0xFD, 0xFD,
];

const ANGLE_TO_X_FRAC = [
  0x00, 0x3E, 0x7A, 0xB1, 0xE2, 0x0A, 0x27, 0x39,
  0x40, 0x39, 0x27, 0x0A, 0xE2, 0xB1, 0x7A, 0x3E,
  0x00, 0xC2, 0x86, 0x4F, 0x1E, 0xF6, 0xD9, 0xC7,
  0xC0, 0xC7, 0xD9, 0xF6, 0x1E, 0x4F, 0x86, 0xC2,
];

const ANGLE_TO_X_INT = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE, 0xFE, 0xFE,
  0xFE, 0xFE, 0xFE, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF,
];
```

To convert to a floating-point velocity for a modern engine:

```typescript
function angleToVelocity(angleIndex: number): { dx: number; dy: number } {
  const i = angleIndex & 0x1F;

  // Convert unsigned int byte to signed
  const signedByte = (b: number) => (b > 127 ? b - 256 : b);

  const dx = signedByte(ANGLE_TO_X_INT[i]) + ANGLE_TO_X_FRAC[i] / 256;
  const dy = signedByte(ANGLE_TO_Y_INT[i]) + ANGLE_TO_Y_FRAC[i] / 256;

  return { dx, dy };
}
```

The maximum speed is ~3 pixels/tick (at angles 0 and 16), minimum ~1.25 pixels/tick (at angles 8 and 24). The table is a standard sine/cosine lookup scaled to a consistent bullet speed.

## Bullet Properties

| Property | Value | Notes |
|----------|-------|-------|
| Type | `PARTICLE_type_hostile_bullet` (3) | Distinguished from player bullets (0), debris (1), stars (2) |
| Lifetime | `0x28` (40 ticks) | Bullet despawns after 40 ticks |
| Velocity | From angle table | Q7.8 fixed-point dx/dy per tick |
| Spawn offset | Per turret type | See turret types table above |

Bullets are stored in a shared particle system with a maximum of `0x1F` (31) particle slots. Bullets, debris, and stars all compete for slots. A new bullet requests a free slot; if none is available, it replaces the oldest recyclable particle (flagged with `PARTICLE_flag`, bit 7).

## Generator Ceasefire Mechanic

Shooting the level's generator temporarily disables all turrets:

```typescript
interface GeneratorState {
  rechargeCounter: number;   // ticks remaining until guns reactivate (0 = guns active)
  rechargeIncrease: number;  // cumulative penalty — each hit takes longer to recover
}

function hitGenerator(state: GeneratorState, rng: () => number): void {
  // New recharge time = random(0-31) + accumulated increase
  const rechargeTime = (rng() & 0x1F) + state.rechargeIncrease;

  if (rechargeTime > 255) {
    // Overflow: generator is destroyed, triggers planet countdown
    state.rechargeCounter = 0xFF;
    // → also triggers planet_countdown_timer = 10 (handled elsewhere)
  } else {
    state.rechargeCounter = rechargeTime;
    state.rechargeIncrease = rechargeTime;  // next hit takes even longer to recover
  }
}

function tickGeneratorRecharge(state: GeneratorState, tickCounter: number): void {
  // Decrements every other tick
  if ((tickCounter & 0x01) === 0 && state.rechargeCounter > 0) {
    state.rechargeCounter--;
  }
}
```

The escalating `rechargeIncrease` means the first generator hit gives a short ceasefire (up to ~31 ticks), but repeated hits stack: the second might give ~62 ticks, the third ~93, and so on until it overflows at 255 and the generator is destroyed — triggering the planet countdown sequence.

## Generator Sparks

While the generator is alive and recharging (`rechargeCounter > 0`), it emits upward-moving debris particles every 8 ticks as a visual cue that it's stunned but recovering:

```typescript
function tickGeneratorSparks(
  generator: GameObject,
  tickCounter: number,
  rechargeCounter: number,
  planetCountdownActive: boolean,
  spawnParticle: (p: Particle) => void
): void {
  if ((tickCounter & 0x07) !== 0) return;  // every 8 ticks only
  if (rechargeCounter === 0) return;        // not recharging
  if (planetCountdownActive) return;

  spawnParticle({
    type: 'debris',
    x: generator.x + 4,
    y: generator.y,
    dx: 0,
    dy: -0.445,   // $FF.8E in Q7.8 ≈ -0.445 — slow upward drift
    lifetime: 10,  // 0x0A ticks
  });
}
```

## Level Data Format

Each level defines its turrets as parallel arrays. Here is level 3 as a worked example:

```typescript
// Level 3 object definitions
const level3 = {
  objectPosX:   [0x8E, 0x5B, 0xAC, 0xAC, 0x92, 0x72, 0x5A, 0x5A, 0x78, 0x6D, 0x8A, 0xA2],
  objectPosY:   [0xD9, 0x40, 0x51, 0x87, 0x57, 0xD0, 0x01, 0x16, 0x24, 0x4C, 0x92, 0xBA],
  objectPosYExt:[0x02, 0x02, 0x02, 0x02, 0x02, 0x01, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02],
  objectType:   [0x05, 0x06, 0x08, 0x08, 0x04, 0x01, 0x00, 0x01, 0x03, 0x00, 0x01, 0x02],
  //             pod   gen   sw_l  sw_l  fuel  gDR   gUR   gDR   gDL   gUR   gDR   gUL
  gunParam:     [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06, 0x06, 0x12, 0x1F, 0x06, 0x1E],
};

// Decoding gun params for the actual turrets (type 0-3 only):
// Index 5:  type=1 (gun_down_right),  param=0x06 → base=0x04, spread=$07 (moderate)
// Index 6:  type=0 (gun_up_right),    param=0x06 → base=0x04, spread=$07 (moderate)
// Index 7:  type=1 (gun_down_right),  param=0x06 → base=0x04, spread=$07 (moderate)
// Index 8:  type=3 (gun_down_left),   param=0x12 → base=0x10, spread=$07 (moderate)
// Index 9:  type=0 (gun_up_right),    param=0x1F → base=0x1C, spread=$0F (wild scatter)
// Index 10: type=1 (gun_down_right),  param=0x06 → base=0x04, spread=$07 (moderate)
// Index 11: type=2 (gun_up_left),     param=0x1E → base=0x1C, spread=$07 (moderate)
```

Non-gun objects (pod, generator, switches, fuel) have gun param bytes of `0x00` which are ignored since the firing check rejects them at the type gate.

## Complete Per-Tick Integration

```typescript
function tickTurrets(
  turrets: Turret[],
  state: GameState,
  config: DifficultyState,
  spawnBullet: (bullet: Particle) => void,
  rng: () => number   // returns 0-255
): void {
  for (const turret of turrets) {
    // Gate: type check
    if (turret.objectType > 3) continue;

    // Gate: generator ceasefire
    if (state.generatorRechargeCounter > 0) continue;

    // Gate: planet countdown
    if (state.planetCountdownActive) continue;

    // Gate: visibility
    if (!turret.isVisible) continue;

    // Gate: probability
    if (rng() >= config.hostileGunShootProbability) continue;

    // Calculate firing angle
    const param = decodeGunParam(turret.gunParam);
    const angle = calculateFiringAngle(param, rng);
    const velocity = angleToVelocity(angle);

    // Spawn bullet
    const bulletOffset = BULLET_OFFSETS[turret.objectType];
    spawnBullet({
      type: 'hostile_bullet',
      x: turret.worldX + bulletOffset.x,
      y: turret.worldY + bulletOffset.y,
      dx: velocity.dx,
      dy: velocity.dy,
      lifetime: 40,
    });
  }
}

const BULLET_OFFSETS = [
  { x: 4, y: 0 },  // gun_up_right
  { x: 4, y: 8 },  // gun_down_right
  { x: 1, y: 0 },  // gun_up_left
  { x: 1, y: 8 },  // gun_down_left
];
```

## Key Design Principles

1. **No player tracking** — turrets fire within a preset cone, not at the player. Threat emerges from placement and density, not omniscient AI. This makes level design the primary difficulty lever.

2. **Global ceasefire reward** — hitting the generator disables *all* turrets simultaneously, giving skilled players a window to navigate dense areas. The escalating recharge time creates a strategic choice: one quick stun for breathing room, or repeated hits risking the planet countdown.

3. **Per-turret personality** — the gun param system lets each turret have unique accuracy and direction. A narrow-spread turret guarding a corridor feels completely different from a wide-scatter turret covering an open area, even though they use the same logic.

4. **Escalating pressure** — probability increases every level and spikes after planet destruction. The player can never settle into a comfort zone; the game keeps tightening.

5. **Shared particle budget** — hostile bullets compete with player bullets, debris, and stars for 31 particle slots. Under heavy fire, visual effects may be displaced by bullets, which is both a resource constraint and an implicit difficulty escalator (more bullets = fewer stars = more austere atmosphere).
