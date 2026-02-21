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
  tickCounter: number;
  turretsFiredThisTick: boolean;
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
    tickCounter: 0,
    turretsFiredThisTick: false,
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
  destroyedTurrets?: Set<number>,
  gunsSuppressed?: boolean,
): void {
  state.turretsFiredThisTick = false;
  // Process each turret
  for (let i = 0; i < level.turrets.length; i++) {
    if (destroyedTurrets?.has(i)) continue;
    const turret = level.turrets[i];
    // Gate: generator ceasefire
    if (gunsSuppressed) continue;

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
    state.turretsFiredThisTick = true;
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

// ---------------------------------------------------------------------------
// Player shooting
// ---------------------------------------------------------------------------

export interface PlayerBullet {
  x: number; y: number;
  dx: number; dy: number;
  active: boolean;
  lifetime: number;
}

export interface PlayerShootingState {
  bullets: PlayerBullet[];   // exactly 4 slots (round-robin)
  bulletIndex: number;       // 0-3, advances after each shot
  pressedFire: boolean;      // single-shot latch
  firedThisTick: boolean;
}

export function createPlayerShootingState(): PlayerShootingState {
  return {
    bullets: [
      { x: 0, y: 0, dx: 0, dy: 0, active: false, lifetime: 0 },
      { x: 0, y: 0, dx: 0, dy: 0, active: false, lifetime: 0 },
      { x: 0, y: 0, dx: 0, dy: 0, active: false, lifetime: 0 },
      { x: 0, y: 0, dx: 0, dy: 0, active: false, lifetime: 0 },
    ],
    bulletIndex: 0,
    pressedFire: false,
    firedThisTick: false,
  };
}

export function tickPlayerShooting(
  state: PlayerShootingState,
  fireKeyDown: boolean,
  shieldActive: boolean,
  shipAngle: number,
  shipX: number,
  shipY: number,
  shipVX: number,
  shipVY: number,
): void {
  // Gate 1: pod destroying player — skip for now (not implemented)

  state.firedThisTick = false;

  // Gate 2: shield/fire mutual exclusion
  if (shieldActive) {
    state.pressedFire = true;
    return;
  }

  // Gate 3: single-shot latch
  if (!fireKeyDown) {
    state.pressedFire = false;
    return;
  }
  if (state.pressedFire) return;

  // Slot availability check
  const slot = state.bullets[state.bulletIndex];
  if (slot.active) return; // slot occupied — cannot fire

  // Create bullet
  state.pressedFire = true;

  // Spawn at ship centre (world position is already centre of mass)
  slot.x = shipX;
  slot.y = shipY;

  // Velocity from ship angle
  const angleIdx = Math.round(shipAngle) & 0x1F;
  slot.dx = ANGLE_X[angleIdx];
  slot.dy = ANGLE_Y[angleIdx];

  // Inherit ship velocity
  slot.dx += shipVX;
  slot.dy += shipVY;

  // Advance 2 steps to clear ship sprite (after full velocity is set)
  slot.x += slot.dx * 2;
  slot.y += slot.dy * 2;

  slot.active = true;
  slot.lifetime = 40;
  state.firedThisTick = true;

  // Advance round-robin index
  state.bulletIndex = (state.bulletIndex + 1) & 0x03;
}

export function tickPlayerBullets(
  state: PlayerShootingState,
): void {
  for (const bullet of state.bullets) {
    if (!bullet.active) continue;
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
    bullet.lifetime--;
    if (bullet.lifetime <= 0) {
      bullet.active = false;
    }
  }
}

export function renderPlayerBullets(
  ctx: CanvasRenderingContext2D,
  state: PlayerShootingState,
  camX: number,
  camY: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  for (const bullet of state.bullets) {
    if (!bullet.active) continue;
    const sx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const sy = Math.round(bullet.y * WORLD_SCALE_Y - camY);
    ctx.fillRect(sx, sy, 2, 2);
  }
}

// ---------------------------------------------------------------------------
// Player bullet collision via collision buffer (pixel-accurate)
// ---------------------------------------------------------------------------

export interface BulletHitResult {
  hitTurrets: number[];
  hitFuel: number[];
  hitGenerator: boolean;
  generatorHitX: number;
  generatorHitY: number;
}

export function processPlayerBulletCollisions(
  state: PlayerShootingState,
  imageData: ImageData,
  camX: number,
  camY: number,
  turrets: readonly { x: number; y: number }[],
  fuel: readonly { x: number; y: number }[],
  destroyedTurrets: Set<number>,
  destroyedFuel: Set<number>,
): BulletHitResult {
  const result: BulletHitResult = { hitTurrets: [], hitFuel: [], hitGenerator: false, generatorHitX: 0, generatorHitY: 0 };
  const { data, width, height } = imageData;

  for (const bullet of state.bullets) {
    if (!bullet.active) continue;
    const bx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const by = Math.round(bullet.y * WORLD_SCALE_Y - camY);

    let hitColor: 'none' | 'terrain' | 'turret' | 'fuel' | 'generator' = 'none';

    for (let px = 0; px < 2 && hitColor === 'none'; px++) {
      for (let py = 0; py < 2 && hitColor === 'none'; py++) {
        const x = bx + px;
        const y = by + py;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (r === 0 && g === 0 && b === 0) continue;
        if (r === 255 && g === 0 && b === 0) { hitColor = 'turret'; }
        else if (r === 255 && g === 0 && b === 255) { hitColor = 'fuel'; }
        else if (r === 0 && g === 255 && b === 255) { hitColor = 'generator'; }
        else { hitColor = 'terrain'; }
      }
    }

    if (hitColor === 'none') continue;
    bullet.active = false;

    if (hitColor === 'turret') {
      // Find nearest non-destroyed turret
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < turrets.length; i++) {
        if (destroyedTurrets.has(i)) continue;
        const dx = bullet.x - turrets[i].x;
        const dy = bullet.y - turrets[i].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestIdx >= 0) result.hitTurrets.push(bestIdx);
    } else if (hitColor === 'fuel') {
      // Find nearest non-destroyed fuel
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < fuel.length; i++) {
        if (destroyedFuel.has(i)) continue;
        const dx = bullet.x - fuel[i].x;
        const dy = bullet.y - fuel[i].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestIdx >= 0) result.hitFuel.push(bestIdx);
    } else if (hitColor === 'generator') {
      result.hitGenerator = true;
      result.generatorHitX = bullet.x;
      result.generatorHitY = bullet.y;
    }
  }

  return result;
}

export function removeBulletsHittingShip(
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

  let hit = false;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    const bx = Math.round(bullet.x * WORLD_SCALE_X - camX);
    const by = Math.round(bullet.y * WORLD_SCALE_Y - camY);
    // Check all 4 pixels of the 2×2 bullet
    let collided = false;
    for (let px = 0; px < 2 && !collided; px++) {
      for (let py = 0; py < 2 && !collided; py++) {
        if (shipPixels.has(`${bx + px},${by + py}`)) {
          collided = true;
        }
      }
    }
    if (collided) {
      bullets.splice(i, 1);
      hit = true;
    }
  }

  return hit;
}
