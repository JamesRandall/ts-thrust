# Thrust: Scoring System — Implementation Reference

This document describes the complete scoring system in the original BBC Micro version of Thrust (6502 assembly by Jeremy C. Smith, 1986), covering score storage, all point sources, the extra life mechanism, and the level completion bonus.

## Score Storage

The score is a **3-byte BCD number** stored little-endian:

| Variable | Address | Digits | Example |
|---|---|---|---|
| `score_A` | $0180 | Ones and Tens | $40 = 40 |
| `score_B` | $0181 | Hundreds and Thousands | $12 = 1200 |
| `score_C` | $0182 | Ten-thousands and Hundred-thousands | $05 = 50000 |

Maximum score: 999,999 (BCD: $99, $99, $99). Initial score: 0.

**All score arithmetic uses 6502 decimal mode (SED/CLD).** This is critical — BCD addition means $40 + $40 = $80, not $80 hex. Every score operation in the game works in BCD.

## Score Addition: `add_A_to_score`

The single function for adding to the score. Called with A = BCD value to add to `score_A`:

```
add_A_to_score(A):
    if demo_mode: return

    old_thousands = score_B & $F0       // save upper nibble (thousands digit)

    SED                                  // enter decimal mode
    score_A += A                         // add to ones/tens (with carry)
    score_B += 0 + carry                 // propagate carry to hundreds/thousands
    score_C += 0 + carry                 // propagate carry to ten-thousands
    CLD                                  // exit decimal mode

    new_thousands = score_B & $F0
    if new_thousands != old_thousands:
        extra_life()                     // award extra life
        countdown_sound()                // play jingle

    display score
```

### Extra Life Trigger

An extra life is awarded whenever the **thousands digit** of the score changes. This is the upper nibble of `score_B`. Since the check compares before and after a single addition, and single additions are always small (max $75 = 75 BCD points), the thousands digit can only change by 1 per call. **One extra life per `add_A_to_score` call, maximum.**

This means an extra life is earned at 1000 points, 2000 points, 3000 points, etc. There is no cap on lives — `extra_life` simply BCD-increments `lives` unconditionally.

### ⚠️ Common Implementation Bug

**The value A is added to `score_A` — the LOWEST byte.** Adding $40 to `score_A` adds 40 points. NOT 4000 points. If you accidentally add to `score_B`, you'll be adding 100x too much and showering the player with extra lives.

The bonus loop adds $40 per iteration = 40 points. The display adds $04 per iteration to `bonus_score` and appends two "0" characters, showing "400" per iteration (really 4000 in the display, but the actual score increment is 40 BCD in `score_A`).

Wait — let me reconsider. The display shows `bonus_score` followed by "00". If bonus_score accumulates $04 per iteration and displays as, say, $20 after 5 iterations, the display reads "2000". But the score adds $40 per iteration × 5 = $200 BCD across the three bytes. $40 × 5 in BCD = $200 added to score_A, which carries into score_B as 200 points. So the actual points per iteration are 40, and the display (×100) shows 4000. The display is cosmetic — the trailing "00" is just two literal zero characters plotted after the bonus_score number.

Actually no. Let me re-examine this more carefully.

$40 added to score_A in BCD:
- score_A goes from $00 → $40 → $80 → $20 (carry) → $60 → $00 (carry) → ...
- Each $40 BCD addition is 40 decimal points added to the ones/tens position.
- After 25 additions of $40: 25 × 40 = 1000 points → thousands digit increments → extra life.

So for a level 0 completion (5 iterations of $40): 5 × 40 = 200 points. The display shows "2000" (bonus_score $20 + "00"). But the actual score increase is 200 points, displayed with two trailing decorative zeros to look like 2000.

Hmm, but that would mean an extra life at displayed "10000" (actual 1000 points, i.e. 25 bonus iterations). That only happens at level 4+ with planet destroyed (14+ iterations). This seems correct — the bonus alone rarely triggers extra lives on early levels.

## Point Sources

### 1. Destroying Objects (Guns and Fuel)

When a player bullet hits a destructible object, the score value is looked up from `obj_type_score_value` and accumulated:

| Object Type | Type ID | Score (BCD) | Points |
|---|---|---|---|
| Gun (up-right) | $0 | $75 | 75 |
| Gun (down-right) | $1 | $75 | 75 |
| Gun (up-left) | $2 | $75 | 75 |
| Gun (down-left) | $3 | $75 | 75 |
| Fuel canister | $4 | $15 | 15 |

Switches ($7, $8), generators ($6), and pod stands ($5) have no score entries and cannot be destroyed.

### Score Accumulation

Object destruction scores are not added directly. They accumulate into `score_accumulation` during the object update loop via `accumulate_score_A`. At the end of the object processing pass (`end_of_objects_function`), the total is added to the score in a single `add_A_to_score` call.

```
score_accumulation = 0   // reset each tick

FOR each object:
    if bullet hits object:
        score_accumulation += obj_type_score_value[object_type]

// After all objects processed:
if score_accumulation != 0:
    add_A_to_score(score_accumulation)
```

This means destroying multiple objects in the same tick accumulates into one addition. The extra life check fires once for the total, not once per object. In practice, it's rare to destroy more than one object per tick.

### 2. Collecting Fuel via Tractor Beam

When a fuel canister is fully collected (tractor counter reaches $1A = 26 ticks of tractor contact):

```
score_accumulation += $30   // 30 BCD points
```

This is accumulated alongside any destruction scores and added at end of tick.

### 3. Level Completion Bonus

Triggered by `mission_complete` when the player escapes to orbit with the pod attached:

```
loop_count = level_number + 5

if planet was destroyed:
    display "PLANET DESTROYED"
    loop_count += 5

for i = loop_count down to 1:
    add_A_to_score($40)        // 40 BCD points per iteration
    bonus_score += $04 (BCD)   // display accumulator
```

**Each iteration calls `add_A_to_score` individually**, so the extra life check fires on every iteration. If a 1000-point boundary is crossed during the loop, an extra life is awarded at that exact iteration.

#### Bonus Points per Level

| Level | Iterations (planet intact) | Points Added | Display |
|---|---|---|---|
| 0 | 5 | 200 | 2000 |
| 1 | 6 | 240 | 2400 |
| 2 | 7 | 280 | 2800 |
| 3 | 8 | 320 | 3200 |
| 4 | 9 | 360 | 3600 |
| 5 | 10 | 400 | 4000 |

With planet destroyed, add 5 more iterations (200 extra points, display +2000).

#### Extra Lives During Bonus

Since each iteration adds 40 points and calls `add_A_to_score` individually, an extra life is triggered whenever the cumulative score crosses a 1000-point boundary. With 10 iterations adding 400 total points, at most **one** extra life can be earned per bonus (the score can only cross one 1000 boundary in 400 points). At level 5 with planet destroyed (15 iterations, 600 points), still at most one extra life.

If you're seeing multiple extra lives from a single bonus, you're adding too much per iteration.

### 4. Pod Crush Kills Player (Score = 0)

The pod crushing the player (`pod_destroying_player_timer` going positive due to pod collision) sets `score_value = $00` before calling the destruction path. So the pod killing you scores nothing.

## No Score Sources Outside These

There is no score for:
- Firing bullets
- Picking up the pod
- Surviving a level without the pod
- Planet countdown events
- Shield/tractor beam usage

## Score Display

The score is displayed as a 6-digit BCD number at a fixed screen position. The display routine (`plot_three_byte_BCD_number`) renders all three bytes as hex digits, which because they're BCD, display as decimal. Leading zeros are shown.

## Extra Life Mechanism: `extra_life`

```
extra_life:
    SED
    lives += $01    // BCD increment
    CLD
```

No maximum check. Lives are stored as BCD, so they can go up to 99 in theory (two BCD digits). The display routine will render whatever value is there.

The initial lives value is set to 4, then `lose_a_life` is called immediately (decrementing to 3 displayed lives).

## Constants Summary

```typescript
// Score storage (BCD, 3 bytes little-endian)
const SCORE_A_ADDR = 0x0180;  // ones/tens
const SCORE_B_ADDR = 0x0181;  // hundreds/thousands
const SCORE_C_ADDR = 0x0182;  // ten-thousands/hundred-thousands

// Extra life: triggers when upper nibble of score_B changes
// i.e. every 1000 points

// Object destruction scores (BCD, added to score_A)
const SCORE_GUN = 0x75;           // 75 points per gun
const SCORE_FUEL_DESTROY = 0x15;  // 15 points per fuel canister (shot)
const SCORE_FUEL_COLLECT = 0x30;  // 30 points per fuel canister (tractor beam)

// Level completion bonus (per iteration, added to score_A)
const BONUS_PER_ITERATION = 0x40;         // 40 BCD points
const BONUS_DISPLAY_PER_ITERATION = 0x04; // display accumulator (shown with "00" suffix)
const BONUS_BASE_ITERATIONS = 5;          // added to level_number
const BONUS_PLANET_DESTROYED_EXTRA = 5;   // extra iterations if planet destroyed

// Lives
const INITIAL_LIVES = 4;          // decremented to 3 before first level
const EXTRA_LIFE_EVERY = 1000;    // points (every time thousands digit changes)
// No cap on lives
```
