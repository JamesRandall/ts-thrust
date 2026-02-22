# Spawn Points & Level Structure Changes — Implementation Spec

## Context

The level decoder (`decode-levels.ts`) has been updated to output multiple spawn/respawn points per level instead of a single starting position. This spec explains how the spawn system works in the original game and what needs to change in the game code to support it.

---

## 1. What Changed in the Level Data

### Before

```typescript
type Level = {
    // ...
    startingPosition: ObjectPosition;  // single { x, y }
    // ...
};
```

### After

```typescript
type SpawnPoint = {
    midpointX: number;   // ship midpoint X position (world coords)
    midpointY: number;   // ship midpoint Y position (16-bit, yHigh*256 + yInt)
    windowX: number;     // initial camera/scroll window X position
    windowY: number;     // initial camera/scroll window Y position (16-bit, yExt*256 + yInt)
};

type Level = {
    // ...
    spawnPoints: SpawnPoint[];  // ordered top-to-bottom by midpointY
    // ...
};
```

The `startingPosition` field no longer exists. All references to it must be updated to use `spawnPoints`.

### What the fields mean

Each spawn point defines two things: where to place the ship, and where to position the camera.

- **`midpointX` / `midpointY`**: Written into the physics midpoint position. This is where the ship appears. When the pod is not attached, the midpoint IS the ship position. When the pod is attached, the midpoint is the centre of the ship-pod system and the ship/pod positions are calculated from it.
- **`windowX` / `windowY`**: Written into the scroll window position. This is the top-left corner of the visible screen area in world coordinates. It determines what the player sees immediately on spawn — the camera doesn't need to scroll to find the ship.

### Spawn point counts per level

| Level | Spawn Points | Notes |
|-------|-------------|-------|
| 0     | 1           | Single open cavern |
| 1     | 1           | Single cavern |
| 2     | 3           | Three depth zones |
| 3     | 3           | Three depth zones |
| 4     | 4           | Four depth zones |
| 5     | 5           | Five depth zones — deepest level |

All levels share the same first spawn point Y position (midpointY=401). The X positions and window positions vary per level to place the ship in a sensible starting location for that level's geometry.

---

## 2. How Spawn Point Selection Works

### Fresh level start

Always use `spawnPoints[0]`. This is the topmost checkpoint, near the surface of the level.

### Death and respawn (checkpoint system)

When the player dies, the game selects the spawn point nearest to (but at or above) the ship's current Y depth. The original 6502 code walks through the spawn points top-to-bottom doing a 16-bit Y comparison:

```typescript
function selectSpawnPoint(level: Level, currentMidpointY: number, hasPod: boolean): {
    spawnPoint: SpawnPoint;
    respawnWithPod: boolean;
} {
    const points = level.spawnPoints;
    let selectedIndex = 0;

    // Walk through checkpoints finding the first one whose Y >= current ship Y.
    // This means "find the deepest checkpoint that is still at or above the ship."
    for (let i = 0; i < points.length; i++) {
        if (points[i].midpointY >= currentMidpointY) {
            selectedIndex = i;
            break;
        }
        // If we exhaust all points without finding one, we've gone deeper than
        // the deepest checkpoint. Fall through with the last valid index.
        if (i === points.length - 1) {
            selectedIndex = i;
        }
    }

    // Pod reattachment logic:
    // If the player had the pod attached when they died and they're not at the
    // first checkpoint, respawn one checkpoint HIGHER (so they don't skip the
    // section where they picked up the pod). If they're already at checkpoint 0,
    // they respawn without the pod.
    let respawnWithPod = false;
    if (hasPod && selectedIndex > 0) {
        selectedIndex--;
        respawnWithPod = true;
    }

    // Edge case: if the adjusted index would go past the last checkpoint,
    // clamp it and don't reattach the pod.
    if (selectedIndex + 1 >= points.length && hasPod && selectedIndex > 0) {
        respawnWithPod = false;
    }

    return {
        spawnPoint: points[selectedIndex],
        respawnWithPod,
    };
}
```

### Respawning with pod attached

When `respawnWithPod` is true, the game must also:

1. Set the pod-attached flags to true
2. Set `angleShipToPod` to `0x01` (pod hanging straight down) for normal gravity, or `0x11` (pod straight up) for reverse gravity

---

## 3. Applying a Spawn Point

When placing the ship at a spawn point (whether fresh start or respawn), apply all four fields:

```typescript
function applySpawnPoint(spawn: SpawnPoint): void {
    // Ship position
    midpointXposInt = spawn.midpointX;
    midpointYposInt = spawn.midpointY & 0xFF;
    midpointYposIntHi = (spawn.midpointY >> 8) & 0xFF;

    // Camera position
    windowXposInt = spawn.windowX;
    windowYposInt = spawn.windowY & 0xFF;
    windowYposExt = (spawn.windowY >> 8) & 0xFF;
}
```

The fractional parts of these positions (midpointXposFrac, midpointYposFrac, etc.) are zeroed during the level reset that precedes spawn point application.

---

## 4. Migration Checklist

- [ ] Update the `Level` type throughout the codebase: remove `startingPosition`, add `spawnPoints: SpawnPoint[]`
- [ ] Add the `SpawnPoint` type
- [ ] Re-run `decode-levels.ts` to regenerate `levels.ts` with the new structure
- [ ] Update fresh level start code to use `level.spawnPoints[0]`
- [ ] Update camera initialisation to use `windowX` / `windowY` from the spawn point (previously these may have been hardcoded or derived differently)
- [ ] Implement spawn point selection on death using the Y-comparison walk described above
- [ ] Implement pod reattachment on respawn when the player had the pod at time of death
- [ ] Set `angleShipToPod` correctly on pod-attached respawn (0x01 normal gravity, 0x11 reverse gravity)
- [ ] If there is any code still referencing `startingPosition`, it will fail to compile — fix all occurrences
