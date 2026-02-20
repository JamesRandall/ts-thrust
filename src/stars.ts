import { orColours } from "./explosions";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";

interface Star {
  x: number;
  y: number;
  lifetime: number;
  color: string;
}

export interface StarFieldState {
  stars: Star[];
  tickCounter: number;
}

const STAR_ALTITUDE_THRESHOLD = 512;
const STAR_Y_OFFSET = 0x64;          // 100
const STAR_X_RANDOM_MASK = 0x3F;     // 0–63
const STAR_X_OFFSET = 5;
const STAR_LIFETIME = 30;

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

export function createStarFieldState(): StarFieldState {
  return { stars: [], tickCounter: 0 };
}

export function tickStarField(
  state: StarFieldState,
  viewportX: number,
  viewportY: number,
  objectColor: string,
  terrainColor: string,
): void {
  // Decrement lifetimes, remove expired
  for (let i = state.stars.length - 1; i >= 0; i--) {
    state.stars[i].lifetime--;
    if (state.stars[i].lifetime <= 0) {
      state.stars.splice(i, 1);
    }
  }

  state.tickCounter++;

  // Only generate on even ticks
  if ((state.tickCounter & 0x01) !== 0) return;

  // Only generate when above altitude threshold
  if (viewportY >= STAR_ALTITUDE_THRESHOLD) return;

  const rndA = randomByte();
  const rndB = randomByte();

  // Y position: random byte + $64, world coordinates (range 100–355)
  const y = rndA + STAR_Y_OFFSET;

  // X position: viewport-relative random 0–63 + viewport X + 5
  const x = (rndB & STAR_X_RANDOM_MASK) + viewportX + STAR_X_OFFSET;

  // Type 1 ($FF) = both colour channels, Type 2 ($0F) = colour 1 only
  const isType2 = (rndB & 0x01) !== 0;
  const color = isType2 ? objectColor : orColours(terrainColor, objectColor);

  state.stars.push({ x, y, lifetime: STAR_LIFETIME, color });
}

export function seedStarField(
  state: StarFieldState,
  viewportX: number,
  objectColor: string,
  terrainColor: string,
): void {
  // Pre-populate ~15 stars within the viewport area with varied lifetimes
  for (let i = 0; i < 15; i++) {
    const rndA = randomByte();
    const rndB = randomByte();
    const y = rndA + STAR_Y_OFFSET;
    const x = (rndB & STAR_X_RANDOM_MASK) + viewportX + STAR_X_OFFSET;
    const isType2 = (randomByte() & 0x01) !== 0;
    const color = isType2 ? objectColor : orColours(terrainColor, objectColor);
    const lifetime = Math.floor(Math.random() * STAR_LIFETIME) + 1;
    state.stars.push({ x, y, lifetime, color });
  }
}

export function renderStars(
  ctx: CanvasRenderingContext2D,
  state: StarFieldState,
  camX: number,
  camY: number,
): void {
  for (const star of state.stars) {
    const sx = Math.round(star.x * WORLD_SCALE_X - camX);
    const sy = Math.round(star.y * WORLD_SCALE_Y - camY);
    if (sx < 0 || sx >= 320 || sy < 0 || sy >= 256) continue;
    ctx.fillStyle = star.color;
    ctx.fillRect(sx, sy, 2, 2);
  }
}
