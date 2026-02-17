import { ANGLE_X, ANGLE_Y } from "./physics";
import { Level } from "./levels";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";
import { SpriteMask } from "./shipSprites";

export interface Bullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface TurretFiringState {
  bullets: Bullet[];
  shootProbability: number;
  generatorRechargeCounter: number;
  tickCounter: number;
}

const MAX_BULLETS = 31;

const SPREAD_TABLE = [0x01, 0x03, 0x07, 0x0F] as const;

// Bullet spawn offsets per turret type (in world coordinates)
const BULLET_OFFSETS: Record<string, { x: number; y: number }> = {
  up_right:   { x: 4, y: 0 },
  down_right: { x: 4, y: 8 },
  up_left:    { x: 1, y: 0 },
  down_left:  { x: 1, y: 8 },
};

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

export function createTurretFiringState(): TurretFiringState {
  return {
    bullets: [],
    shootProbability: 1,
    generatorRechargeCounter: 0,
    tickCounter: 0,
  };
}

export function tickTurrets(
  state: TurretFiringState,
  level: Level,
  playerX: number,
  playerY: number,
  camX: number,
  camY: number,
  viewportW: number,
  viewportH: number,
): void {
  // Decrement generator recharge every other tick
  if (state.generatorRechargeCounter > 0) {
    if ((state.tickCounter & 0x01) === 0) {
      state.generatorRechargeCounter--;
    }
  }

  // Process each turret
  for (const turret of level.turrets) {
    // Gate: generator ceasefire
    if (state.generatorRechargeCounter > 0) continue;

    // Gate: visibility — convert turret world pos to screen
    const screenX = turret.x * WORLD_SCALE_X - camX;
    const screenY = turret.y * WORLD_SCALE_Y - camY;
    if (screenX < 0 || screenX >= viewportW || screenY < 0 || screenY >= viewportH) continue;

    // Gate: probability
    if (randomByte() >= state.shootProbability) continue;

    // Max bullets check
    if (state.bullets.length >= MAX_BULLETS) continue;

    // Decode gun param and calculate firing angle
    const param = turret.gunParam;
    const spreadIndex = param & 0x03;
    const baseAngleOffset = param & 0x1C;
    const spreadMask = SPREAD_TABLE[spreadIndex];

    const rndA = randomByte();
    const rndB = randomByte();
    const jitter = rndA & 0x03;
    const spread = rndB & spreadMask;
    const angle = (spread + baseAngleOffset + jitter) & 0x1F;

    // Get bullet velocity from angle tables
    const dx = ANGLE_X[angle];
    const dy = ANGLE_Y[angle];

    // Get spawn offset
    const offset = BULLET_OFFSETS[turret.direction];

    // Spawn bullet in world coordinates
    state.bullets.push({
      x: turret.x + offset.x,
      y: turret.y + offset.y,
      dx,
      dy,
    });
  }

  // Update all bullets: move, remove when off-screen
  state.bullets = state.bullets.filter(bullet => {
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
    const sx = bullet.x * WORLD_SCALE_X - camX;
    const sy = bullet.y * WORLD_SCALE_Y - camY;
    return sx > -2 && sx < viewportW && sy > -2 && sy < viewportH;
  });

  state.tickCounter = (state.tickCounter + 1) & 0xFF;
}

export function renderBullets(
  ctx: CanvasRenderingContext2D,
  bullets: Bullet[],
  camX: number,
  camY: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  for (const bullet of bullets) {
    const sx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const sy = Math.round(bullet.y * WORLD_SCALE_Y - camY);
    ctx.fillRect(sx, sy, 2, 2);
  }
}

export function removeCollidingBullets(
  state: TurretFiringState,
  imageData: ImageData,
  camX: number,
  camY: number,
): void {
  const { data, width, height } = imageData;

  state.bullets = state.bullets.filter(bullet => {
    const bx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const by = Math.round(bullet.y * WORLD_SCALE_Y - camY);
    for (let px = 0; px < 2; px++) {
      for (let py = 0; py < 2; py++) {
        const x = bx + px;
        const y = by + py;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Terrain is blue (0,0,255) in the collision buffer
        if (r === 0 && g === 0 && b === 255) return false;
      }
    }
    return true;
  });
}

export function testBulletShipCollision(
  bullets: Bullet[],
  shipMask: SpriteMask,
  shipScreenX: number,
  shipScreenY: number,
  camX: number,
  camY: number,
): boolean {
  // Build Set of ship pixel positions for O(1) lookup
  const shipPixels = new Set<string>();
  for (const { dx, dy } of shipMask) {
    shipPixels.add(`${shipScreenX + dx},${shipScreenY + dy}`);
  }

  for (const bullet of bullets) {
    const bx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const by = Math.round(bullet.y * WORLD_SCALE_Y - camY);
    // Check all 4 pixels of the 2×2 bullet
    for (let px = 0; px < 2; px++) {
      for (let py = 0; py < 2; py++) {
        if (shipPixels.has(`${bx + px},${by + py}`)) {
          return true;
        }
      }
    }
  }

  return false;
}
