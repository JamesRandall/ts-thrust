import { Level } from "./levels";
import { fillPolygon, Point, bbcMicroColours, WORLD_SCALE_X, WORLD_SCALE_Y, WORLD_WIDTH } from "./rendering";
import { SpriteMask, TurretSprites } from "./shipSprites";

export enum CollisionResult {
  None       = 0,
  Terrain    = 1,
  Fuel       = 2,
  Turret     = 3,
  PowerPlant = 4,
  Pod        = 5,
}

export interface CollisionBuffer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

// Sentinel colour for terrain in the collision buffer.
// Blue is not used by any object type, so it's unambiguous.
const TERRAIN_COLLISION_COLOUR = "#0000ff";

export function createCollisionBuffer(width: number, height: number): CollisionBuffer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx, width, height };
}

export function renderCollisionBuffer(
  buf: CollisionBuffer,
  level: Level,
  camX: number,
  camY: number,
  fuelSprite?: ImageBitmap,
  turretSprites?: TurretSprites,
  powerPlantSprite?: ImageBitmap,
  podStandSprite?: ImageBitmap,
  destroyedTurrets?: Set<number>,
  destroyedFuel?: Set<number>,
): void {
  const { ctx, width, height } = buf;
  ctx.clearRect(0, 0, width, height);

  const wx = (x: number) => x * WORLD_SCALE_X;
  const wy = (y: number) => y * WORLD_SCALE_Y;

  // Terrain polygons at three offsets to handle wrapping
  const offsets = [-WORLD_WIDTH, 0, WORLD_WIDTH];
  for (const offset of offsets) {
    for (const poly of level.polygons) {
      const points: Point[] = [];
      for (let i = 0; i < poly.length; i += 2) {
        points.push({ x: wx(poly[i]) - camX + offset, y: wy(poly[i + 1]) - camY });
      }
      fillPolygon(ctx, points, TERRAIN_COLLISION_COLOUR, Math.round(camY));
    }
  }

  // Objects (with wrapping)
  const toScreenX = (worldX: number) => {
    let sx = wx(worldX) - camX;
    while (sx < -WORLD_WIDTH / 2) sx += WORLD_WIDTH;
    while (sx > WORLD_WIDTH / 2) sx -= WORLD_WIDTH;
    return sx;
  };

  const drawMarker = (ox: number, oy: number, colour: string) => {
    const sx = Math.round(toScreenX(ox));
    const sy = Math.round(wy(oy) - camY);
    ctx.fillStyle = colour;
    ctx.fillRect(sx - 3, sy - 3, 7, 7);
  };

  if (powerPlantSprite) {
    const sx = Math.round(toScreenX(level.powerPlant.x));
    const sy = Math.round(wy(level.powerPlant.y) - camY);
    ctx.fillStyle = bbcMicroColours.cyan;
    ctx.fillRect(sx, sy - 2, powerPlantSprite.width, powerPlantSprite.height);
  } else {
    drawMarker(level.powerPlant.x, level.powerPlant.y, bbcMicroColours.cyan);
  }
  if (podStandSprite) {
    const sx = Math.round(toScreenX(level.podPedestal.x));
    const sy = Math.round(wy(level.podPedestal.y) - camY);
    ctx.fillStyle = bbcMicroColours.white;
    ctx.fillRect(sx, sy - 1, podStandSprite.width, podStandSprite.height);
  } else {
    drawMarker(level.podPedestal.x, level.podPedestal.y, bbcMicroColours.white);
  }
  for (let i = 0; i < level.fuel.length; i++) {
    if (destroyedFuel?.has(i)) continue;
    const f = level.fuel[i];
    if (fuelSprite) {
      const sx = Math.round(toScreenX(f.x));
      const sy = Math.round(wy(f.y) - camY);
      const fx = Math.round(sx - fuelSprite.width / 2);
      const fy = sy - 2;
      ctx.fillStyle = bbcMicroColours.magenta;
      ctx.fillRect(fx, fy, fuelSprite.width, fuelSprite.height);
    } else {
      drawMarker(f.x, f.y, bbcMicroColours.magenta);
    }
  }
  for (let i = 0; i < level.turrets.length; i++) {
    if (destroyedTurrets?.has(i)) continue;
    const t = level.turrets[i];
    if (turretSprites) {
      // Use upRight as representative size (all 4 are the same dimensions)
      const w = turretSprites.upRight.width;
      const h = turretSprites.upRight.height;
      const sx = Math.round(toScreenX(t.x));
      const sy = Math.round(wy(t.y) - camY);
      ctx.fillStyle = bbcMicroColours.red;
      ctx.fillRect(sx, sy - 1, w, h);
    } else {
      drawMarker(t.x, t.y, bbcMicroColours.red);
    }
  }
}

export function testCollision(
  buf: CollisionBuffer,
  mask: SpriteMask,
  shipScreenX: number,
  shipScreenY: number,
): CollisionResult {
  const { ctx, width, height } = buf;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let result = CollisionResult.None;

  for (const { dx, dy } of mask) {
    const px = shipScreenX + dx;
    const py = shipScreenY + dy;

    if (px < 0 || px >= width || py < 0 || py >= height) continue;

    const idx = (py * width + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    if (r + g + b === 0) continue;

    // Identify what was hit — higher-priority results override lower
    let hit: CollisionResult;
    if (r === 0 && g === 0 && b === 255) {
      hit = CollisionResult.Terrain;
    } else if (r === 255 && g === 0 && b === 0) {
      hit = CollisionResult.Turret;
    } else if (r === 0 && g === 255 && b === 255) {
      hit = CollisionResult.PowerPlant;
    } else if (r === 255 && g === 255 && b === 255) {
      hit = CollisionResult.Pod;
    } else if (r === 255 && g === 0 && b === 255) {
      hit = CollisionResult.Fuel;
    } else {
      hit = CollisionResult.Terrain; // unknown colour — treat as terrain
    }

    // Terrain is highest priority — return immediately
    if (hit === CollisionResult.Terrain) return CollisionResult.Terrain;
    if (hit === CollisionResult.Turret) return CollisionResult.Turret;

    // For lower-priority hits, keep the highest seen so far
    if (result === CollisionResult.None || hit < result) {
      result = hit;
    }
  }

  return result;
}
