# Pixel-Perfect Collision Detection

## Background

The original BBC Micro Thrust detects collisions by reading pixels directly from the screen buffer: after drawing terrain and objects (but before drawing the ship), it samples the pixels where the ship *would* be drawn. Any non-black pixel means a collision. We replicate this approach using an offscreen canvas.

## Approach: offscreen collision buffer

Each frame, render terrain and objects (everything except the ship and HUD) to a second, offscreen `<canvas>` at the same 320x256 internal resolution. Then, for every opaque pixel in the current ship sprite, sample the collision buffer at that screen position. A non-zero (non-black) pixel means a hit.

This is faithful to the original, automatically respects the scanline parity fill, handles world wrapping, and lets us distinguish *what* was hit by colour.

## New file: `src/collision.ts`

### Types

```ts
export const enum CollisionResult {
  None     = 0,
  Terrain  = 1,
  Fuel     = 2,
  Turret   = 3,
  PowerPlant = 4,
  Pod      = 5,
}
```

### Setup — `createCollisionBuffer(width, height): CollisionBuffer`

```ts
export interface CollisionBuffer {
  canvas: OffscreenCanvas;
  ctx:    OffscreenCanvasRenderingContext2D;
  width:  number;
  height: number;
}
```

Creates a single `OffscreenCanvas` (320x256) reused every frame. Created once at startup and passed into the game loop alongside the display canvas.

### Per-frame — `renderCollisionBuffer(buf, level, camX, camY)`

Draws into the collision buffer using the same camera and world-scale transforms as `renderLevel` in `rendering.ts`. Draws:

1. **Terrain polygons** — reuse `fillPolygon` with the level's terrain colour (or a fixed sentinel colour — either works, since any non-black pixel triggers terrain collision).
2. **Object markers** — each object type drawn in its distinctive colour (magenta = fuel, cyan = power plant, white = pod pedestal, red = turret). Same 7x7 `fillRect` as the visible renderer.

Does **not** draw the ship sprite or HUD.

The collision buffer is cleared to black (`#000000`) at the start of each frame.

### Test — `testCollision(buf, shipSprite, shipScreenX, shipScreenY): CollisionResult`

1. Read the collision buffer's `ImageData` (full frame, cached across the call).
2. Read the ship sprite's pixel data (the `ImageBitmap` from `loadShipSprites`). Because `ImageBitmap` can't be read directly, extract pixel data once per sprite index change into a small canvas (ship sprites are ~16x16 — negligible cost).
3. For each pixel in the ship sprite where `alpha > 0`, look up `(shipScreenX + dx, shipScreenY + dy)` in the collision buffer.
4. If that pixel is non-black (`r + g + b > 0`), determine what was hit from the colour:
   - Matches level `terrainColor` → `Terrain`
   - `#ff00ff` → `Fuel`
   - `#00ffff` → `PowerPlant`
   - `#ffffff` → `Pod`
   - `#ff0000` → `Turret`
5. Return the first (highest-priority) hit found, or `None`.

Priority order: `Terrain` > `Turret` > `PowerPlant` > `Pod` > `Fuel` > `None`. Terrain and turret kills override pickups.

### Optimisation: ship sprite mask cache

Extract each of the 32 ship sprites' opaque pixel offsets into a `{dx, dy}[]` array once at load time (in `loadShipSprites` or a new helper). This avoids re-reading the sprite bitmap every frame. The cache is a `Map<number, {dx: number, dy: number}[]>` keyed by sprite index.

## Integration with game loop

### `game.ts` changes

Add to `GameState`:

```ts
collisionResult: CollisionResult;
```

In `tick()`, after updating physics and syncing `player.x/y/rotation`, store the collision result:

```ts
state.collisionResult = collisionResult;
```

`tick` itself doesn't call the collision functions — it receives the result from `main.ts` because collision detection needs rendering artefacts (camera, sprites) that live there.

### `main.ts` changes

In the frame loop, after `tick()`:

1. Compute `camX`, `camY` (same formula as `renderLevel`).
2. Call `renderCollisionBuffer(collisionBuf, game.level, camX, camY)`.
3. Compute `shipScreenX`, `shipScreenY` (same as `renderLevel`'s ship draw position).
4. Call `testCollision(collisionBuf, shipMasks[spriteIdx], shipScreenX, shipScreenY)`.
5. Store result on `game.collisionResult`.
6. Render visible frame as before.

```
tick(game, dt, keys)

renderCollisionBuffer(buf, game.level, camX, camY)
collision = testCollision(buf, shipMasks[spriteIdx], shipScreenX, shipScreenY)
game.collisionResult = collision

ctx.clearRect(...)
renderLevel(ctx, ...)          // visible canvas
drawStatusBar(ctx, ...)
```

### Camera / coordinate helpers

`renderLevel` currently computes `camX`, `camY`, `toScreenX` etc. as local closures. Extract the camera calculation into a shared pure function in `rendering.ts`:

```ts
export function computeCamera(
  playerX: number, playerY: number,
  screenW: number, screenH: number
): { camX: number; camY: number }
```

Both `renderLevel` and `renderCollisionBuffer` call this so coordinates are guaranteed identical.

## Responding to collisions (initial implementation)

For the first pass, any non-`None` collision resets the level: call `resetGame(state)` in `game.ts` which resets `player.x/y` to `level.startingPosition`, zeroes rotation, and calls `physics.resetMotion()`. This gives immediate visual feedback that collision detection is working.

Future iterations will distinguish collision types:

- **Terrain / Turret** → destroy ship (lose a life, reset position)
- **Fuel** → increment `game.fuel`, remove the fuel pickup from the level
- **PowerPlant** → begin destruction sequence
- **Pod** → attach pod (toggle `physics.setPodAttached`)

### `game.ts` — `resetGame(state: GameState): void`

```ts
export function resetGame(state: GameState): void {
  state.player.x = state.level.startingPosition.x;
  state.player.y = state.level.startingPosition.y;
  state.player.rotation = 0;
  state.physics.state.x = state.level.startingPosition.x;
  state.physics.state.y = state.level.startingPosition.y;
  state.physics.state.angle = 0;
  state.physics.resetMotion();
}
```

Called from `main.ts` when `testCollision` returns anything other than `None`.

## Verification

- `npx tsc --noEmit` passes.
- Flying into terrain produces `CollisionResult.Terrain`.
- Flying over a fuel marker produces `CollisionResult.Fuel`.
- No collision when flying through open space.
- No visible rendering change — the collision buffer is offscreen only.
- No measurable frame-rate drop (collision buffer is 320x256, ship mask is ~16x16 — at most ~100 pixel reads per frame).
