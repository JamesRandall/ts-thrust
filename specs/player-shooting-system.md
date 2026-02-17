# Player Shooting System — Reference from BBC Micro *Thrust* (1986)

Extracted from the annotated 6502 disassembly of *Thrust* by Jeremy C. Smith (disassembly by Kieran HJ Connell, 2016). This describes the player bullet firing, slot management, velocity inheritance, and collision system for implementation in a TypeScript game engine.

## Overview

The player can fire bullets in the direction the ship is currently facing. Bullets inherit the ship's velocity, creating realistic inertial-frame physics. A hard limit of four active player bullets is enforced through a dedicated round-robin slot system that is separate from the general particle pool. Firing is single-shot only — the fire key must be released and re-pressed for each shot.

## Fire Control — Input Gating

Three gates must pass before a bullet is created. They are evaluated in order; failure at any gate aborts the entire fire attempt for that tick.

### Gate 1: Ship State

```typescript
// Ship must not be in the process of being destroyed by the pod
if (podDestroyingPlayerTimer >= 0) return;  // blocked
```

When the pod swings into the ship (destruction sequence), firing is completely disabled.

### Gate 2: Shield/Tractor Exclusion

```typescript
// Cannot fire while shield/tractor beam is active
if (shieldTractorPressed) {
  playerPressedFire = true;  // suppress: treat as if fire was already held
  return;
}
```

Shield and fire are mutually exclusive. Holding shield sets the fire latch to "already pressed" so that releasing shield doesn't immediately fire a bullet — the player must explicitly press fire again.

### Gate 3: Single-Shot Latch

```typescript
// Read fire key (Return in original)
const fireKeyDown = isKeyPressed('fire');

if (!fireKeyDown) {
  playerPressedFire = false;  // key released — reset latch
  return;
}

// Key is down — but was it already down last tick?
if (playerPressedFire) return;  // still held — no autofire

// Fresh press — proceed to slot check
```

This enforces one bullet per keypress. There is no autofire. The player must release and re-press for each shot. The latch (`playerPressedFire`) is set to `true` when a bullet is created and cleared when the key is released.

## Bullet Slot Management — The Four-Slot Round Robin

Player bullets occupy a **dedicated, fixed range** of the particle table: slots 0–3. They do not use the general free-slot allocator that hostile bullets, stars, and debris use (slots 4–31). This guarantees player bullets are never displaced by other particle types.

### Slot Availability Check

```typescript
// bullet_index cycles 0 → 1 → 2 → 3 → 0 → ...
const slot = bulletIndex;
const particle = particles[slot];

if (particle.type === PARTICLE_TYPE_PLAYER_BULLET && particle.lifetime > 0) {
  // Slot is occupied by a still-active player bullet — cannot fire
  return;
}

// Slot is free (bullet expired or was overwritten by another type) — fire
```

The check has two paths to "free":

1. **Type is not player bullet** (`type !== 0`) — the slot was recycled by the system for something else (e.g., during an explosion). It's available.
2. **Type is player bullet but lifetime is 0** — the bullet has expired naturally. It's available.

If the slot contains an active player bullet, the shot is simply blocked. The player must wait for that specific bullet to expire or collide before slot `bulletIndex` becomes available again. This means under sustained fire, the effective fire rate is governed by bullet lifetime (40 ticks) divided by 4 slots = one new bullet every ~10 ticks at maximum.

### Index Advancement

After creating a bullet, the index advances:

```typescript
bulletIndex = (bulletIndex + 1) & 0x03;  // wraps 0→1→2→3→0
```

This round-robin ensures even distribution. Each new bullet goes into the next slot regardless of the state of other slots.

## Bullet Creation

### Spawn Position

The bullet spawns at the player's current world position with a centring offset:

```typescript
bullet.x = player.x + 4;  // centre on ship sprite (ship is ~8px wide)
bullet.y = player.y + 5;  // centre on ship sprite (ship is ~10px tall)
```

Both fractional and integer parts are copied from the player position, preserving sub-pixel precision.

### Direction from Ship Angle

The bullet's base velocity is looked up from the same 32-entry angle table used by turrets:

```typescript
const angleIndex = shipAngle;  // 0-31, where 0=up, 8=right, 16=down, 24=left
const baseVelocity = angleToVelocity(angleIndex);
```

See the turret spec for the full angle table data and the `angleToVelocity` conversion function.

### Initial Position Advance

Immediately after setting the velocity, the bullet is moved forward by **2 velocity steps**:

```typescript
for (let i = 0; i < 2; i++) {
  bullet.x += bullet.dx;
  bullet.y += bullet.dy;
}
```

This pushes the bullet clear of the ship sprite so it doesn't register a collision with the player on its first frame. Without this, the bullet would spawn inside the ship hitbox.

### Velocity Inheritance

After the position advance, the player's current velocity is **added** to the bullet's velocity:

```typescript
bullet.dx += player.velocityX;
bullet.dy += player.velocityY;
```

This is the key physics detail: bullets inherit the ship's momentum. The consequences are:

- Firing in the direction of travel produces fast bullets
- Firing against the direction of travel produces slow (or even stationary) bullets
- Firing perpendicular to travel produces bullets that drift sideways
- A stationary ship produces bullets at the base table speed

This creates authentic Newtonian feel and adds a skill dimension — experienced players learn to account for their velocity when aiming.

### Final Properties

```typescript
bullet.type = PARTICLE_TYPE_PLAYER_BULLET;  // 0
bullet.lifetime = 0x28;  // 40 ticks
```

## Bullet-Object Collision

Each tick, during the object update loop, every active object is tested against all four player bullet slots. The test iterates slots 3 down to 0.

### Hit Test (AABB)

```typescript
const OBJ_TYPE_WIDTH =  [5, 5, 5, 5, 4, 5, 5, 2, 2];
//                       gUR gDR gUL gDL fuel pod gen swR swL
const OBJ_TYPE_HEIGHT = [8, 8, 8, 8, 10, 8, 10, 8, 8];

function testBulletHitsObject(
  bullet: Particle,
  object: GameObject,
  objWidth: number,
  objHeight: number
): boolean {
  // Must be an active player bullet
  if (bullet.lifetime === 0) return false;
  if (bullet.type !== PARTICLE_TYPE_PLAYER_BULLET) return false;

  // X range check: bullet must be within [object.x, object.x + width)
  const dx = bullet.xInt - object.xInt;
  if (dx < 0 || dx >= objWidth) return false;

  // Y range check: bullet must be within [object.y, object.y + height)
  // 16-bit comparison (INT_HI must match exactly)
  const dyHi = bullet.yIntHi - object.yExt;
  if (dyHi !== 0) return false;

  const dy = bullet.yInt - object.yInt;
  if (dy < 0 || dy >= objHeight) return false;

  return true;
}
```

### On Hit — Object Response

When a bullet hits an object, the bullet is killed (lifetime cleared to just the recyclable flag) and the object is handled based on its type:

```typescript
enum ObjectResponse {
  DESTROY,           // guns (0-3) and fuel (4) — removed from level with explosion and score
  TOGGLE_DOOR,       // door switches (7, 8) — triggers door animation, creates explosion
  HIT_GENERATOR,     // generator (6) — starts ceasefire recharge counter
  INDESTRUCTIBLE,    // pod stand (5) — bullet absorbed, no effect on object
}

function getObjectResponse(objectType: number): ObjectResponse {
  switch (objectType) {
    case 7: case 8:  return ObjectResponse.TOGGLE_DOOR;
    case 6:          return ObjectResponse.HIT_GENERATOR;
    case 5:          return ObjectResponse.INDESTRUCTIBLE;
    default:         return ObjectResponse.DESTROY;  // types 0-4
  }
}
```

### Processing Order

The code flow after a hit detection is:

1. **Kill the bullet** — lifetime is masked to just the PARTICLE_flag bit (marking it recyclable)
2. **Door switches** (types 7, 8) — set the door counter to `$FF`, create an explosion at the bullet position
3. **Generator** (type 6) — create an explosion at the bullet position, apply the generator recharge mechanic (see turret spec)
4. **Destroyable objects** (types 0–4, i.e. guns and fuel) — only if type < pod_stand (5):
   - Clear the object's active flag in `level_obj_flags` (bit 1 cleared)
   - Create an explosion at the object centre (+2, +4 offset)
   - Award score
   - Remove the object from the level

Objects of type ≥ 5 (pod stand, generator, door switches) are never removed from the level by bullets — they either have special handling or are indestructible.

### Score Values

Scores are stored in BCD (binary-coded decimal) and displayed as the value × 10:

| Object Type | Raw BCD Value | Displayed Score |
|-------------|---------------|-----------------|
| Gun (any orientation, types 0–3) | `$75` | 750 |
| Fuel (type 4) | `$15` | 150 |

### Explosion Particles

Destroying an object creates an explosion. The explosion type depends on what was destroyed:

| Object Type | Explosion Particle Type | Particle Count |
|-------------|------------------------|----------------|
| Gun (0–3) | `$02` (star-like) | 8 |
| Fuel (4) | `$01` (debris) | 8 |
| Door switch hit | `$04` → random (`$01` or `$02`) | 3 |
| Generator hit | `$04` → random (`$01` or `$02`) | 3 |

Type `$04` is a special "random debris" marker — when `create_explosion` sees it, it reduces the particle count to 3, randomly picks type 1 or 2, and randomises the explosion's starting angle. This makes door switch and generator hit effects smaller and more varied than object destruction explosions.

Each explosion particle gets:

- A position at the explosion origin
- A velocity from the angle table (with ±3 steps of random jitter per particle)
- Particles are spaced 4 angle steps apart (360° / 8 = 45° per particle for full explosions)
- A randomised lifetime between roughly 8–23 ticks
- Two initial movement steps to spread particles outward from the centre immediately

## Hostile Bullet vs Player Collision

For completeness, hostile bullets also test against the player each tick using a proximity check (not AABB):

```typescript
function testHostileBulletHitsPlayer(
  bullet: Particle,
  player: PlayerState
): { hit: boolean; shieldBlocked: boolean } {
  if (bullet.type !== PARTICLE_TYPE_HOSTILE_BULLET) {
    return { hit: false, shieldBlocked: false };
  }

  // X proximity: bullet.x - player.x must be in range [3, 5]
  // (unsigned subtraction — tests a 3-pixel window)
  const dx = (bullet.xInt - player.xInt) & 0xFF;
  if (dx < 3 || dx > 5) return { hit: false, shieldBlocked: false };

  // Y proximity: must be same page (INT_HI match) and delta in range [2, 6]
  const dyHi = bullet.yIntHi - player.yIntHi;
  if (dyHi !== 0) return { hit: false, shieldBlocked: false };

  const dy = (bullet.yInt - player.yInt) & 0xFF;
  if (dy < 2 || dy > 6) return { hit: false, shieldBlocked: false };

  // Ship must be plotted on screen
  if (!player.spriteVisible) return { hit: false, shieldBlocked: false };

  // Bullet is killed regardless of shield
  bullet.lifetime = bullet.lifetime & 0x80;  // keep only recyclable flag

  // Shield absorbs the hit
  if (player.shieldActive) {
    return { hit: false, shieldBlocked: true };
  }

  // No shield — player takes damage
  return { hit: true, shieldBlocked: false };
}
```

The hitbox is deliberately small and offset — roughly a 3×5 pixel window — rather than matching the full ship sprite. This gives the player a forgiving feel, especially since bullets move fast and the ship is manoeuvring against gravity.

If the shield is active, the bullet is still destroyed but the collision flag is not set — the player survives.

## Complete Per-Tick Integration

```typescript
interface PlayerShootingState {
  bulletIndex: number;          // 0-3, round-robin
  playerPressedFire: boolean;   // single-shot latch
}

interface PlayerState {
  x: number;           // Q7.8 world position
  y: number;           // Q10.8 world position
  velocityX: number;   // Q7.8
  velocityY: number;   // Q10.8
  shipAngle: number;   // 0-31
  shieldActive: boolean;
  spriteVisible: boolean;
  podDestroyingTimer: number;
}

const BULLET_LIFETIME = 40;
const BULLET_SPAWN_OFFSET_X = 4;
const BULLET_SPAWN_OFFSET_Y = 5;
const BULLET_INITIAL_ADVANCE_STEPS = 2;

function tickPlayerShooting(
  fireKeyDown: boolean,
  player: PlayerState,
  shooting: PlayerShootingState,
  particles: Particle[],
  playSound: (sound: string) => void
): void {
  // Gate 1: ship destruction sequence
  if (player.podDestroyingTimer >= 0) return;

  // Gate 2: shield exclusion
  if (player.shieldActive) {
    shooting.playerPressedFire = true;
    return;
  }

  // Gate 3: single-shot latch
  if (!fireKeyDown) {
    shooting.playerPressedFire = false;
    return;
  }
  if (shooting.playerPressedFire) return;

  // Slot availability check
  const slot = shooting.bulletIndex;
  const bullet = particles[slot];

  if (bullet.type === 0 && bullet.lifetime > 0) {
    // Slot occupied by active player bullet — cannot fire
    return;
  }

  // === Create bullet ===

  shooting.playerPressedFire = true;

  // Spawn at ship centre
  bullet.x = player.x + BULLET_SPAWN_OFFSET_X;
  bullet.y = player.y + BULLET_SPAWN_OFFSET_Y;

  // Velocity from ship angle
  const vel = angleToVelocity(player.shipAngle);
  bullet.dx = vel.dx;
  bullet.dy = vel.dy;

  // Advance 2 steps to clear ship sprite
  for (let i = 0; i < BULLET_INITIAL_ADVANCE_STEPS; i++) {
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
  }

  // Inherit ship velocity
  bullet.dx += player.velocityX;
  bullet.dy += player.velocityY;

  // Set particle properties
  bullet.lifetime = BULLET_LIFETIME;
  bullet.type = 0;  // PARTICLE_TYPE_PLAYER_BULLET

  // Advance round-robin index
  shooting.bulletIndex = (slot + 1) & 0x03;

  playSound('own_gun');
}
```

## Particle Table Layout

For reference, here is how the particle table is partitioned:

```
Slots 0-3:   Reserved for player bullets (round-robin)
Slots 4-31:  General pool — hostile bullets, debris, stars, explosions
              Allocated via particle_return_free_slot_in_Y
              which searches from slot 31 downward
```

The general pool allocator searches for an empty slot (lifetime = 0). If none is found, it searches for a slot with remaining lifetime < 10 ticks and the recyclable flag set, cannibalising the oldest short-lived particle. This means under heavy load, stars and debris are displaced before bullets.

Player bullets never enter the general pool and are never displaced by other particle types. The four-slot limit is absolute.

## Key Design Principles

1. **Single-shot latch** — no autofire forces deliberate aiming. Each bullet is a conscious decision, which pairs well with the four-bullet limit to create resource tension.

2. **Dedicated slot pool** — player bullets are guaranteed their four slots regardless of particle system load. The player's firepower is never degraded by explosions, stars, or hostile fire consuming particle slots.

3. **Round-robin blocking** — when all four bullets are active, the player can't fire until the oldest one expires. This creates natural fire rate limiting without an explicit cooldown timer. At maximum sustained fire rate, the effective cadence is one bullet every ~10 ticks (40-tick lifetime ÷ 4 slots).

4. **Velocity inheritance** — bullets carry the ship's momentum, creating authentic Newtonian physics. This rewards skilled play: a player who learns to account for their velocity can land shots more effectively, while a stationary player gets consistent but predictable bullet behaviour.

5. **Two-step advance** — spawning the bullet ahead of the ship prevents self-collision and makes the weapon feel immediate rather than sluggish. The bullet appears to emerge from the nose of the ship rather than from its centre.

6. **Shield/fire mutual exclusion** — the player must choose between defence and offence on every tick. This creates moment-to-moment tactical decisions, especially when navigating dense turret fire near objectives.

7. **Forgiving hostile hitbox** — the hostile bullet proximity check uses a smaller window (3×5) than the ship sprite, giving the player slightly more room than visuals suggest. Combined with shield absorption, this prevents the game from feeling unfair despite the increasing fire density.
