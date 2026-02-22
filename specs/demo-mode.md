# Thrust Demo Mode — Implementation Spec

## Context

This spec describes the demo/attract mode system from the BBC Micro game Thrust (Jeremy Smith, 1986), reverse-engineered from the annotated 6502 disassembly by Kieran Connell. The demo plays a scripted sequence of fake keypresses through the real game engine — there is no separate demo renderer or pre-recorded replay. The existing TypeScript codebase already has the title screen, high score table display, game engine (physics, rendering, collision, particles, objects), and a tick loop. This spec covers only the demo mode plumbing.

---

## 1. Overview

The demo system has three phases:

1. **High Score Screen** — displays scores, animates objects/particles, waits for spacebar or timeout
2. **Demo Level Setup** — initialises level 0 with randomised keypress timers, teleports player in
3. **Demo Playback** — runs the normal tick loop with a fake input layer injecting scripted keypresses

When the demo ship crashes or the player presses any key, it loops back to phase 1. If the player presses spacebar during phase 1, a real game starts instead.

---

## 2. Input Abstraction Layer

The entire demo system hinges on a single abstraction: all game input must go through one function that can be intercepted in demo mode.

### 2.1 Input Actions

There are exactly five input actions, each mapped to a single bit in a bitmask:

```typescript
enum InputBit {
  RotateLeft    = 0x01,  // Original: Caps Lock (INKEY $BF)
  RotateRight   = 0x02,  // Original: Ctrl      (INKEY $FE)
  Fire          = 0x04,  // Original: Return     (INKEY $B6)
  Thrust        = 0x08,  // Original: Shift      (INKEY $FF)
  ShieldTractor = 0x10,  // Original: Space      (INKEY $9D)
}
```

### 2.2 `isKeyPressed(action: InputBit): boolean`

This is the equivalent of the original `test_inkey` function. Every piece of game code that reads player input MUST call this function — never read keyboard state directly.

Behaviour:
- If `demoModeFlag === false`: read from real keyboard/gamepad state and return whether that key is currently held
- If `demoModeFlag === true`: look up the action's bit in `demoKeypressBitMask` and return `(demoKeypressBitMask & action) !== 0`
- **Exception**: Escape/pause input should ALWAYS read from real hardware, even in demo mode. The original skips the demo intercept when checking for INKEY_escape ($8F). This allows the player to break out of the demo at any time.

### 2.3 Migration Requirement

If the existing codebase reads keyboard state directly in `shipInputRotate`, `shipInputFire`, `shipInputThrustCalculateForce`, `updateShieldTractorDrawShipAndPod`, or any other input-consuming function, those reads must be refactored to go through `isKeyPressed()`. Without this, the demo has no way to inject inputs.

---

## 3. Demo State Variables

```typescript
let demoModeFlag: boolean = false;           // false = real game, true = demo mode
let demoKeypressBitMask: number = 0x00;      // current fake key state (combination of InputBit values)
let demoKeypressTimer: number = 0;           // ticks remaining for current keypress entry
let demoKeypressIndex: number = 0;           // index into the keypress sequence tables
```

---

## 4. Demo Keypress Sequence Data

The demo is driven by two parallel arrays: one defines WHICH keys are held, the other defines FOR HOW LONG (in ticks).

### 4.1 Bit Mask Table

```typescript
const DEMO_KEYPRESS_BIT_MASK_TABLE: number[] = [
  0x00,  //  0: nothing (freefall)
  0x02,  //  1: rotate right
  0x00,  //  2: nothing
  0x04,  //  3: fire
  0x01,  //  4: rotate left
  0x10,  //  5: shield/tractor
  0x18,  //  6: thrust + shield (0x08 | 0x10)
  0x00,  //  7: nothing
  0x01,  //  8: rotate left
  0x00,  //  9: nothing
  0x18,  // 10: thrust + shield
  0x08,  // 11: thrust
  0x0A,  // 12: rotate right + thrust (0x02 | 0x08)
  0x08,  // 13: thrust
  0x0A,  // 14: rotate right + thrust
  0x08,  // 15: thrust
  0x0A,  // 16: rotate right + thrust
  0x08,  // 17: thrust
];
```

### 4.2 Timer Table

The first 8 entries are fixed. Entries 8–17 are written during demo setup with randomised values (see section 5). The initial fixed values:

```typescript
const DEMO_KEYPRESS_TIMER_TABLE_FIXED: number[] = [
  0x18,  //  0: 24 ticks of nothing
  0x0F,  //  1: 15 ticks rotate right
  0x05,  //  2:  5 ticks nothing
  0x05,  //  3:  5 ticks fire
  0x08,  //  4:  8 ticks rotate left
  0x14,  //  5: 20 ticks shield/tractor
  0x17,  //  6: 23 ticks thrust + shield
  0x0F,  //  7: 15 ticks nothing
];
```

Entries 8–17 are populated at demo start from the randomised timer values (see next section). The full timer table is therefore 18 entries long, matching the bitmask table.

---

## 5. Demo Level Setup (`levelStartDemoEntry`)

Called when the high score timeout expires. Performs these steps in order:

### 5.1 Randomise Keypress Timers

Generate random values using your existing RNG and write them into timer table slots 8–17:

```
slot  8: (rnd() & 0x03) + 0x08    — "rnd_A" — range [8, 11]
slot  9: (rnd() & 0x03) + 0x04    — "rnd_A continuation" — but see note below
slot 10: result of big-spin roll (see below)
slot 11: (rnd() & 0x03) + 0x04    — "rnd_B"
slot 12: see layout note
...
```

**Important**: The original stores these randomised values into specific labelled memory locations that are embedded within the timer table. The layout is:

```
Offset 0–7:   fixed timers (as above)
Offset 8:     demo_keypress_timer_rnd_A[0]  — (rnd() & 0x03) + 0x08
Offset 9:     demo_keypress_timer_rnd_A[1]  — second byte, value 0x0D (fixed in original data)
Offset 10:    demo_keypress_timer_rnd_A[2]  — value 0x26 (fixed)
Offset 11:    demo_keypress_timer_rnd_A[3]  — value 0x0D (fixed)
Offset 12:    demo_keypress_timer_rnd_B[0]  — (rnd() & 0x03) + 0x04
Offset 13:    demo_keypress_timer_rnd_C[0]  — big spin value (see below)
Offset 14:    demo_keypress_timer_rnd_C[1]  — value 0x14 (fixed)
Offset 15:    demo_keypress_timer_rnd_C[2]  — value 0x0A (fixed)
Offset 16:    demo_keypress_timer_rnd_C[3]  — value 0x0F (fixed)
Offset 17:    demo_keypress_timer_rnd_C[4]  — value 0x7F (fixed)
```

In the original, only three bytes are actually randomised — the rest are static data that happens to sit in the same contiguous memory region. The simplest TypeScript approach is to store the full 18-entry timer array and only overwrite the three randomised slots at demo start:

```typescript
const demoKeypressTimerTable: number[] = [
  // Fixed entries 0–7
  0x18, 0x0F, 0x05, 0x05, 0x08, 0x14, 0x17, 0x0F,
  // Entries 8–17 (slots 8, 12, 13 get randomised at demo start)
  0x08, 0x0D, 0x26, 0x0D, 0x06, 0x7F, 0x14, 0x0A, 0x0F, 0x7F,
];

function setupDemoTimers(): void {
  demoKeypressTimerTable[8]  = (rnd() & 0x03) + 0x08;  // rnd_A
  demoKeypressTimerTable[12] = (rnd() & 0x03) + 0x04;  // rnd_B

  // Big spin: 75% chance of 0x7F, 25% chance of 0x23
  let bigSpin = 0x7F;
  if ((rnd() & 0x03) === 0) {
    bigSpin = 0x23;
  }
  demoKeypressTimerTable[13] = bigSpin;                 // rnd_C
}
```

### 5.2 Reset Demo State

```typescript
demoKeypressIndex = 0;
demoKeypressBitMask = 0x00;
demoKeypressTimer = 0;  // will trigger immediate advance on first tick
levelTickCounter = 0;
```

### 5.3 Initialise Level

Use level 0, no reverse gravity, no invisible landscape, gun probability = 2:

```typescript
initialiseLevelPointers(0);   // or however your level init works
levelReset();
initialiseLandscape();
updateWindowAndTerrainTables();
calculatePlayerPositionFromMidpoint();
landscapeDraw();
updateAndDrawAllObjects();
```

### 5.4 Wait + Teleport In

Wait approximately 8 vsync periods (≈160ms at 50Hz), then run the player teleport-appear animation. After teleport completes, set `levelTickState = 0` (running) and reset the system clock.

### 5.5 Enter Tick Loop

Fall through into the normal tick loop. `demoModeFlag` is already `true`.

---

## 6. Demo Tick (`demoModeTick`)

Called as the FIRST action in every tick loop iteration.

```typescript
function demoModeTick(): void {
  if (!demoModeFlag) return;

  demoKeypressTimer--;
  if (demoKeypressTimer < 0) {
    demoModeNextKeypress();
  }
}

function demoModeNextKeypress(): void {
  const index = demoKeypressIndex;
  demoKeypressBitMask = DEMO_KEYPRESS_BIT_MASK_TABLE[index];
  demoKeypressTimer = demoKeypressTimerTable[index];
  demoKeypressIndex++;
}
```

**Edge case**: If `demoKeypressIndex` exceeds 17 (the table length), the original 6502 code would read past the end of the tables into whatever data follows in memory. In practice this doesn't happen because the ship always crashes before reaching the end. However, as a safety measure, either cap the index or add a bounds check that jumps to `highScoreStart` if exceeded.

---

## 7. High Score Screen Loop (`highScoreStart`)

### 7.1 Setup

```typescript
function highScoreStart(): void {
  // Reset game state for display
  invisibleLandscapeFlag = false;
  levelNumber = 0;
  reverseGravityFlag = false;
  highScoreTimeOut = 0x8C;  // 140
  hostileGunShootProbability = 2;

  // Initialise level 0 for background display
  initialiseLevelPointers(0);
  levelReset();
  initialiseLandscape();
  updateWindowAndTerrainTables();
  landscapeDraw();
  drawPodAndCollisionTest();
  updateAndDrawAllObjects();

  // Draw UI
  plotHighScoreTable();
  writeTop8Thrusters();
  writePressSpacebar();

  // Reset demo state
  demoKeypressBitMask = 0x00;
  demoKeypressTimer = 0;
  demoKeypressIndex = 0;

  // Enter high score tick loop
  highScoreTickLoop();
}
```

### 7.2 Tick Loop

```typescript
function highScoreTickLoop(): void {
  while (true) {
    levelTickCounter++;
    updateAndDrawAllObjects();
    particlesUpdateAndDraw();

    // Check for spacebar — start real game
    demoModeFlag = false;
    if (isSpacebarPressed()) {   // real hardware read, not through demo system
      startNewGame();
      return;
    }
    demoModeFlag = true;         // immediately set back — we're still in attract mode

    // Only decrement timeout every other tick
    if ((levelTickCounter & 0x01) === 0) continue;

    highScoreTimeOut--;
    if (highScoreTimeOut === 0) {
      clearScreenAndInit();
      wait(10);  // ~10 vsync periods
      levelStartDemoEntry();
      return;
    }
  }
}
```

The `demoModeFlag` toggling on every iteration is faithful to the original — it's set to false optimistically before checking spacebar (which reads real hardware since `demoModeFlag` is false at that point), then set back to true if spacebar wasn't pressed.

---

## 8. Exiting Demo Mode

### 8.1 Any Key During Demo Playback

In the tick loop, after checking for escape and after the main tick work, when `demoModeFlag` is true:

```typescript
// Inside tick loop, after normal game logic
if (demoModeFlag) {
  if (anyKeyPressed()) {   // real hardware read — was there any keypress?
    highScoreStart();      // break out to high score screen
    return;
  }
}
```

The original uses OSBYTE $81 (read key with short timeout). Any keypress at all (not just spacebar) exits the demo.

### 8.2 Ship Crash During Demo

When `levelEndedFlag` becomes true (ship collision/death) and `demoModeFlag` is true, jump to `highScoreStart()`. Do NOT process lives, game-over, or retry logic — just go straight back to the high score screen.

```typescript
if (levelEndedFlag) {
  if (demoModeFlag) {
    highScoreStart();
    return;
  }
  // ... normal death/retry/game-over logic for real games ...
}
```

### 8.3 Level Completion During Demo

When the ship escapes to orbit during demo, also jump to `highScoreStart()`. The scripted inputs are not designed to complete a level, but handle it gracefully in case it happens.

---

## 9. Full Attract Mode Cycle

The overall cycle is:

```
game_entry
  └──▶ highScoreStart (display scores, wait)
         ├── spacebar ──▶ startNewGame (real game begins)
         └── timeout ──▶ levelStartDemoEntry
                           └──▶ tickLoop (with demoModeFlag = true)
                                  ├── any key ──▶ highScoreStart (loop)
                                  └── crash ──▶ highScoreStart (loop)
```

This cycle repeats indefinitely until the player presses spacebar.

---

## 10. What the Demo Sequence Looks Like

For reference, the scripted inputs produce roughly this behaviour on level 0:

1. Ship appears via teleport, sits motionless — gravity pulls it down (24 ticks)
2. Rotates right (15 ticks) — ship tilts
3. Brief pause (5 ticks)
4. Fires a shot (5 ticks)
5. Rotates left (8 ticks)
6. Activates shield/tractor beam (20 ticks)
7. Thrusts while holding shield (23 ticks) — ship starts moving with shield active
8. Pause (15 ticks)
9. Rotates left (randomised 8–11 ticks)
10. Pause (fixed 13 ticks)
11. Long thrust+shield or fire sequence (fixed/randomised mix)
12. Alternating thrust and thrust+rotate-right — the ship flies around erratically
13. Eventually crashes into terrain → back to high score screen

The 25% "big spin" variant (timer slot 13 = 0x23 instead of 0x7F) makes one of the thrust+shield segments much shorter, causing a tighter, more dramatic spiral.

---

## 11. Implementation Checklist

- [ ] Create `InputBit` enum with the five action bits
- [ ] Implement `isKeyPressed(action: InputBit): boolean` with demo mode intercept
- [ ] Refactor all existing input reads (`shipInputRotate`, `shipInputFire`, `shipInputThrustCalculateForce`, `updateShieldTractorDrawShipAndPod`) to use `isKeyPressed`
- [ ] Ensure escape/pause always reads real hardware even in demo mode
- [ ] Add demo state variables: `demoModeFlag`, `demoKeypressBitMask`, `demoKeypressTimer`, `demoKeypressIndex`
- [ ] Add the two demo sequence tables (18 entries each) as module-level constants
- [ ] Implement `demoModeTick()` and `demoModeNextKeypress()`
- [ ] Implement `setupDemoTimers()` with the three randomised slots and big-spin logic
- [ ] Implement `levelStartDemoEntry()` — randomise timers, reset state, init level, teleport, enter tick loop
- [ ] Implement `highScoreStart()` with its inner tick loop
- [ ] Add demo exit: any-key check in tick loop when `demoModeFlag` is true
- [ ] Add demo exit: crash detection (`levelEndedFlag` while in demo) → `highScoreStart`
- [ ] Add demo exit: orbit escape while in demo → `highScoreStart`
- [ ] Add bounds check for `demoKeypressIndex` exceeding table length
- [ ] Test the full attract cycle: high scores → timeout → demo plays → crash → high scores → repeat
- [ ] Test spacebar during high score screen starts a real game with `demoModeFlag = false`
- [ ] Test any key during demo playback returns to high score screen
