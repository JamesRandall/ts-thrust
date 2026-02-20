# Thrust: Level Completion — Implementation Reference

This document describes the level completion trigger, end-of-level branching, bonus scoring, and level progression in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986).

## Orbit Escape Trigger

Every tick, after all physics and rendering, the game calls `test_player_escaped_to_orbit`. This checks whether the midpoint (the physics body, whether or not the pod is attached) has reached a critical altitude:

```
IF midpoint_ypos_INT_HI == $01 AND midpoint_ypos_INT < $20:
    carry clear → escaped
ELSE:
    carry set → not escaped
```

The Y coordinate system has Y increasing downward, with `INT_HI:INT` forming a 16-bit value. The threshold `$0120` (288 decimal) is near the very top of the world. Since terrain surfaces typically start around `INT_HI = $01` with higher INT values, this threshold is above all terrain — the player has flown above the map.

An additional guard checks `pod_destroying_player_timer`: if it's positive (player is dying), the escape is not processed even if altitude is reached.

## End-of-Level Branching

When the player escapes to orbit, the game runs a teleport-out animation, then branches based on state:

```
test_player_escaped_to_orbit() → escaped

wait(3 centiseconds)
player_entered_orbit()          // teleport animation + sound
wait(20 centiseconds)
show_landscape()                // restore palette

IF demo_mode:       → high score screen
IF fuel_empty:      → game over ("OUT OF FUEL")
IF pod_attached:    → MISSION COMPLETE (bonus + next level)
IF countdown < 0:   → "MISSION INCOMPLETE" (lose life, retry level)
ELSE:               → "PLANET DESTROYED" (lose life, next level, no bonus)
```

### Path 1: Mission Complete (pod attached)

The player escaped with the pod. Calls `mission_complete` for bonus scoring, then `start_new_level`.

### Path 2: Mission Incomplete (no pod, no countdown)

The player escaped without the pod and the planet is intact. Displays "MISSION INCOMPLETE". Costs one life. Retries the same level (calls `level_retry`).

### Path 3: Planet Destroyed (countdown was active)

The planet countdown was triggered (generator overflow) and the player escaped before it reached zero. Displays "PLANET DESTROYED". Costs one life. Sets `planet_destroyed_hostile_gun_modifier = 8` as punishment. Proceeds to next level via `start_new_level` — but with no bonus.

### Death via `level_ended_flag`

If the player dies during gameplay (collision, pod crushes ship, countdown reaches zero), `level_ended_flag` is set. The tick loop detects this and:

1. If fuel empty → game over
2. Otherwise → lose a life
3. If lives == 0 → game over
4. If countdown was active → display "PLANET DESTROYED", proceed to next level (no bonus)
5. Otherwise → retry same level

## Bonus Scoring: `mission_complete`

The bonus calculation uses a loop count derived from the level number and planet status:

```
loop_count = level_number + 5

IF planet_countdown_timer >= 0:  // planet was destroyed
    display "PLANET DESTROYED"
    loop_count += 5              // bonus for surviving destruction

FOR i = loop_count down to 1:
    score += $40 (BCD)           // 40 points per iteration (displayed as 4000 with trailing zeros)
    bonus_display += $04 (BCD)   // accumulates the display bonus value
```

### Bonus Values by Level (planet intact)

| Level | loop_count | Score Added | Displayed Bonus |
|---|---|---|---|
| 0 | 5 | 5 × $40 = $200 (BCD) | 2000 |
| 1 | 6 | 6 × $40 = $240 (BCD) | 2400 |
| 2 | 7 | 7 × $40 = $280 (BCD) | 2800 |
| 3 | 8 | 8 × $40 = $320 (BCD) | 3200 |
| 4 | 9 | 9 × $40 = $360 (BCD) | 3600 |
| 5 | 10 | 10 × $40 = $400 (BCD) | 4000 |

### Bonus Values by Level (planet destroyed)

Add 5 to loop_count:

| Level | loop_count | Score Added | Displayed Bonus |
|---|---|---|---|
| 0 | 10 | $400 (BCD) | 4000 |
| 1 | 11 | $440 (BCD) | 4400 |
| 2 | 12 | $480 (BCD) | 4800 |
| 3 | 13 | $520 (BCD) | 5200 |
| 4 | 14 | $560 (BCD) | 5600 |
| 5 | 15 | $600 (BCD) | 6000 |

The bonus is displayed as the accumulated `bonus_score` value followed by "00" (two zero characters are plotted after the number), so a bonus_score of $20 displays as "2000".

### Extra Life Trigger

`add_A_to_score` checks if the thousands digit of the score changed after each addition. If it did, `extra_life` is called — the player gains a life for every 1000 points. Since the bonus loop adds $40 per iteration, this can trigger multiple extra lives during a large bonus.

## Level Progression: `start_new_level`

### Level Number Cycling

```
level_number += 1
IF level_number == 6:
    level_number = 0

    // Toggle modifiers on each full cycle
    IF reverse_gravity_flag == 0:
        reverse_gravity_flag = $FF       // enable reverse gravity
    ELSE:
        reverse_gravity_flag = $00       // disable reverse gravity
        invisible_landscape_flag ^= $0F  // toggle invisible landscape
```

The 6 levels repeat in order. After completing all 6:
- First cycle-through: reverse gravity is enabled
- Second cycle-through: reverse gravity disabled, invisible landscape enabled
- Third cycle-through: reverse gravity enabled again
- And so on, alternating

### Mission Number

```
mission_number += 1  (BCD increment)
```

Mission number is purely for display — it counts total completed missions starting from 1.

### Hostile Gun Difficulty Scaling

```
IF mission_number >= 3:
    level_hostile_gun_probability += 1
    IF level_hostile_gun_probability > $23 (35):
        level_hostile_gun_probability = $23  // cap at 35

hostile_gun_shoot_probability = level_hostile_gun_probability + planet_destroyed_hostile_gun_modifier
planet_destroyed_hostile_gun_modifier = 0  // reset after applying
```

From mission 3 onward, guns become progressively more aggressive, capping at probability 35. If the planet was destroyed on the previous level, an additional +8 is added as punishment (but only for that one level).

### Bonus Messages

Every 4th level start (`extra_string_counter & 0x03 == 0`), a bonus message is displayed from a rotating set of messages, along with the star field generation animation.

## State Flow

```
EACH TICK:
    ... physics, rendering, etc ...
    |
    v
test_player_escaped_to_orbit()
    |
    |--- not escaped AND level_ended_flag not set → continue tick loop
    |
    |--- not escaped AND level_ended_flag set (death) →
    |       IF fuel_empty → GAME OVER
    |       lose_a_life()
    |       IF lives == 0 → GAME OVER
    |       IF countdown active → "PLANET DESTROYED" → start_new_level (no bonus)
    |       ELSE → level_retry (same level)
    |
    |--- escaped AND player dying → continue tick loop (ignore escape)
    |
    |--- escaped AND player alive →
            teleport animation
            |
            |--- fuel_empty → GAME OVER
            |--- pod_attached → mission_complete (bonus) → start_new_level
            |--- countdown inactive → "MISSION INCOMPLETE" → lose life → level_retry
            |--- countdown active → "PLANET DESTROYED" → lose life → start_new_level (no bonus)
```

## Constants Summary

```typescript
// Orbit escape threshold
const ORBIT_ESCAPE_Y_HI = 0x01;
const ORBIT_ESCAPE_Y_INT = 0x20;   // must be < this (midpoint_ypos < $0120)

// Bonus scoring (BCD)
const BONUS_SCORE_PER_LOOP = 0x40;  // added to score each iteration
const BONUS_DISPLAY_PER_LOOP = 0x04; // added to displayed bonus each iteration
const BONUS_BASE_LOOPS = 5;         // added to level_number for loop count
const BONUS_PLANET_DESTROYED_EXTRA = 5; // extra loops if planet was destroyed

// Difficulty
const GUN_PROBABILITY_INCREASE_FROM_MISSION = 3; // starts increasing at mission 3
const GUN_PROBABILITY_CAP = 0x23;                // 35 decimal
const PLANET_DESTROYED_GUN_MODIFIER = 8;         // punishment for destroying planet

// Lives
const INITIAL_LIVES = 4;           // set then decremented by lose_a_life at start = 3 displayed
const EXTRA_LIFE_THRESHOLD = 1000; // every 1000 points (BCD thousands digit change)
```
