# Thrust: Player Death Sequence — Implementation Reference

This document describes what happens when the player's ship is destroyed in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering collision detection triggers, the ship explosion, the death countdown timer, tether retraction, pod destruction, palette changes, and the transition to level retry or game over.

## Death Triggers

Two collision flags are checked every tick in `update_player_and_pod_states`:

```
IF plot_ship_collision_detected != 0:  → destroy_player_ship
IF plot_pod_collision_detected != 0:   → destroy_attached_pod
```

These flags are set during the sprite plotting routines when a pixel collision is detected (XOR rendering — if the plotted pixel doesn't match what was written, something was already there). The ship can also be killed by the planet countdown reaching zero (`plot_ship_collision_detected` is set directly in that case).

## Ship Destruction: `destroy_player_ship`

### Guard

```
IF player_ship_destroyed_flag >= 0 (already destroyed or in progress):
    return  // only trigger once
```

`player_ship_destroyed_flag` is $FF (negative) during normal play. It's set to $01 (positive) on first destruction, preventing re-entry.

### Actions

```
pod_destroying_player_timer = $3C      // 60 ticks — starts the death countdown
plot_ship_collision_detected = 0       // clear the trigger flag
player_ship_destroyed_flag = $01       // mark ship as destroyed
level_tick_state = $01                 // signal to rendering system

// Explosion origin: old ship position + offset to centre
explosion_xpos_FRAC = old_player_xpos_FRAC
explosion_xpos_INT  = old_player_xpos_INT + 4    // centre X
explosion_ypos_INT  = old_player_ypos_INT + 5    // centre Y
explosion_ypos_INT_HI = old_player_ypos_INT_HI + carry

// Explosion parameters
explosion_angle = PARTICLE_type_debris ($01)      // fixed starting angle, NOT random
explosion_particle_type = PARTICLE_type_debris ($01)

create_explosion()  // spawns 8 debris particles (standard explosion)
```

### Differences from Turret Explosion

The explosion uses the same `create_explosion` routine as guns and fuel, but:

| Property | Gun Explosion | Player Ship Explosion |
|---|---|---|
| Particle count | 8 | 8 |
| Particle type | $02 (star — yellow) | $01 (debris — white) |
| Starting angle | Inherited/contextual | Fixed at $01 |
| Origin offset | +2 X, +4 Y from object | +4 X, +5 Y from old ship position |
| Uses old position | No (current object pos) | Yes (`old_player_xpos/ypos`) |

Using the old position ensures the explosion appears where the ship was before the collision frame, not where it would have moved to.

## Pod Destruction: `destroy_attached_pod`

Triggered either by `plot_pod_collision_detected` (pod hit terrain) or when `top_nibble_index` goes negative during the death countdown and the pod is attached.

### Actions

```
level_tick_state = $01
pod_attached_flag_1 = 0                // detach pod
plot_pod_collision_detected = 0        // clear trigger
pod_destroying_player_timer = $3C      // reset timer to 60 (restarts countdown)

// Explosion at pod position
explosion_xpos_FRAC = pod_xpos_FRAC
explosion_xpos_INT  = pod_xpos_INT
explosion_ypos_INT  = pod_ypos_FRAC    // note: FRAC used as INT (pod Y is stored differently)
explosion_ypos_INT_HI = pod_ypos_INT_HI

explosion_angle = PARTICLE_type_debris ($01)
explosion_particle_type = PARTICLE_type_debris ($01)

create_explosion()
```

### Pod Destruction Resets the Timer

When the pod explodes, `pod_destroying_player_timer` is reset to $3C (60). This means the full 60-tick countdown runs again after the pod explodes, giving the full death animation time for both explosions.

## Death Countdown Timer: `pod_destroying_player_timer`

The timer starts at $3C (60) and decrements every tick in `update_player_and_pod_states` while it is non-negative (>= 0).

### Per-Tick During Countdown

```
IF pod_destroying_player_timer < 0: skip (normal play)

// Restore landscape colour (in case it was hidden)
IF planet_countdown_timer != 0:
    set palette colour 2 to level landscape colour

pod_destroying_player_timer -= 1

IF pod_destroying_player_timer == 0:
    level_ended_flag = $FF    // end the level
    return

IF pod_destroying_player_timer == $28 (40):
    set palette colour 0 to black   // darken the background

// Tether retraction (every tick)
top_nibble_index -= 2

IF top_nibble_index < 0:
    // Tether fully retracted — trigger secondary destruction
    IF player_ship_destroyed_flag < 0 ($FF):
        destroy_player_ship()     // ship hasn't been destroyed yet (pod hit first)
    ELIF pod_attached_flag_1 != 0:
        destroy_attached_pod()    // pod still attached — destroy it now
```

### Timeline (Ship Dies First — Most Common)

| Timer Value | Ticks Elapsed | Event |
|---|---|---|
| $3C (60) | 0 | Ship explodes, timer starts, `player_ship_destroyed_flag = 1` |
| $3B–$29 | 1–19 | Tether retracts (`top_nibble_index` decrements by 2 per tick) |
| $28 (40) | 20 | Background palette set to black |
| ~$35 | ~7 | `top_nibble_index` reaches 0 (from 14, -2 per tick = 7 ticks) |
| ~$34 | ~8 | `top_nibble_index` goes negative → `destroy_attached_pod` fires |
| $3C (reset) | — | Pod explodes, timer resets to 60 |
| ... | ... | Second 60-tick countdown runs (no more tether retraction) |
| $28 | 20 | Background goes black again |
| $00 | 60 | `level_ended_flag` set, level ends |

### Timeline (Pod Dies First — Less Common)

If the pod hits terrain first:

| Timer Value | Event |
|---|---|
| $3C (60) | Pod explodes, `pod_attached_flag_1 = 0`, timer starts |
| ~7 ticks | `top_nibble_index` goes negative → `destroy_player_ship` fires |
| $3C (reset) | Ship explodes, timer resets |
| ... | Second countdown |
| $00 | Level ends |

### Solo Ship Death (No Pod)

If the pod is not attached, the death is simpler:

| Timer Value | Event |
|---|---|
| $3C (60) | Ship explodes, timer starts |
| $28 (40) | Background goes black |
| ~7 ticks | `top_nibble_index` goes negative, but no pod → no secondary explosion |
| $00 | Level ends |

## Tether Retraction Visual

During the death countdown, `top_nibble_index` is decremented by 2 every tick. This variable controls the length of the tether in `calculate_attached_pod_vector` — it determines how many angle vectors are accumulated to compute the ship-to-pod offset.

Starting at $0E (14), it reaches 0 after 7 ticks, then goes negative after 8 ticks. While positive, the pod visually retracts toward the midpoint as the tether shortens. The connecting line (drawn via `draw_new_line` when `pod_line_exists_flag` is set) gets shorter each frame.

During the death sequence, `pod_line_exists_flag` is set to 1 while the pod is attached and the ship is destroyed, ensuring the line is drawn during retraction:

```
IF player_ship_destroyed_flag < 0 ($FF, i.e. ship still intact):
    IF pod_attached_flag_1 != 0:
        pod_line_exists_flag = 1   // show tether during death
```

## Physics During Death

The force calculation (`ship_input_thrust_calculate_force`) continues during the death countdown — gravity still applies to the midpoint. The guard condition checks `pod_destroying_player_timer BMI` (branches if negative/alive), so when the timer is positive (dying), the code falls through to the force calculation. However:

- Thrust input is blocked (`pod_destroying_player_timer BPL no_thrust`)
- Shield input is blocked (`pod_destroying_player_timer BPL no_sheild_tractor`)
- The midpoint continues to move under gravity and existing momentum
- Angular velocity continues (pendulum keeps swinging)

This means during the death sequence, the ship debris and retracting pod still fall under gravity and drift with any momentum they had — they don't freeze in place.

## Palette Changes During Death

| Event | Colour | Value |
|---|---|---|
| Timer == $28 | Colour 0 (background) | Set to black ($00) |
| Each tick (if planet countdown active) | Colour 2 (landscape) | Restored to level colour |

The background going black at tick 20 (out of 60) creates a dramatic darkening effect partway through the death sequence.

## Constants Summary

```typescript
// Death timer
const DEATH_TIMER_INITIAL = 0x3C;          // 60 ticks
const DEATH_BACKGROUND_BLACK_AT = 0x28;    // 40 — timer value when background goes black
const DEATH_TIMER_END = 0x00;              // level ends when timer reaches 0

// Tether retraction
const TETHER_RETRACT_RATE = 2;             // top_nibble_index decremented by 2 per tick
const TETHER_INITIAL_INDEX = 0x0E;         // 14 — takes 7 ticks to reach 0, 8 to go negative

// Ship explosion
const SHIP_EXPLOSION_X_OFFSET = 4;         // added to old_player_xpos_INT
const SHIP_EXPLOSION_Y_OFFSET = 5;         // added to old_player_ypos_INT
const SHIP_EXPLOSION_PARTICLE_TYPE = 0x01; // debris (white)
const SHIP_EXPLOSION_START_ANGLE = 0x01;   // fixed, not random

// Pod explosion (same particle type)
const POD_EXPLOSION_PARTICLE_TYPE = 0x01;
const POD_EXPLOSION_START_ANGLE = 0x01;

// Explosion particle count (standard create_explosion)
const EXPLOSION_PARTICLE_COUNT = 8;
```
