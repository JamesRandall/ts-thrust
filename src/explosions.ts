import { ANGLE_X, ANGLE_Y } from "./physics";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";

const EXPLOSION_PARTICLE_COUNT = 8;
const EXPLOSION_ANGLE_STEP = 4;
const EXPLOSION_VELOCITY_DIVISOR = 16;
const EXPLOSION_INITIAL_KICK = 2;
const ANGLE_MASK = 0x1F;
const RANDOM_OFFSET_MASK = 0x03;
const MAGNITUDE_MASK = 0x03;
const MAGNITUDE_BASE = 2;
const LIFETIME_XOR_MASK = 0x1F;
const LIFETIME_NIBBLE_MASK = 0x0F;

export interface ExplosionParticle {
  x: number;
  y: number;
  dx: number;
  dy: number;
  lifetime: number;
  color: string;
}

export interface ExplosionState {
  particles: ExplosionParticle[];
}

export function createExplosionState(): ExplosionState {
  return { particles: [] };
}

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

export function spawnExplosion(state: ExplosionState, worldX: number, worldY: number, color: string, startAngle?: number): void {
  let explosionAngle = startAngle !== undefined ? (startAngle & ANGLE_MASK) : (randomByte() & ANGLE_MASK);

  for (let p = 0; p < EXPLOSION_PARTICLE_COUNT; p++) {
    const rndA = randomByte();
    const rndB = randomByte();

    // Random offset 0–3 added to angle
    const randomOffset = rndA & RANDOM_OFFSET_MASK;
    const angle = (explosionAngle + randomOffset) & ANGLE_MASK;

    // Base velocity from angle tables, divided by 16
    const baseDx = ANGLE_X[angle] / EXPLOSION_VELOCITY_DIVISOR;
    const baseDy = ANGLE_Y[angle] / EXPLOSION_VELOCITY_DIVISOR;

    // Magnitude = 2–5×
    const magnitude = (rndB & MAGNITUDE_MASK) + MAGNITUDE_BASE;
    const dx = baseDx * magnitude;
    const dy = baseDy * magnitude;

    // Lifetime: inverse correlation with speed
    // (magnitude << 3) ^ 0x1F gives higher values for lower magnitudes
    const lifetimeBase = (magnitude << 3) ^ LIFETIME_XOR_MASK;
    const lifetime = ((rndA & LIFETIME_NIBBLE_MASK) >> 1) + lifetimeBase + 8;

    // 2-step initial kick
    const x = worldX + dx * EXPLOSION_INITIAL_KICK;
    const y = worldY + dy * EXPLOSION_INITIAL_KICK;

    state.particles.push({ x, y, dx, dy, lifetime, color });

    // Advance explosion angle by 4 per particle (8×4 = 32, full circle)
    explosionAngle = (explosionAngle + EXPLOSION_ANGLE_STEP) & ANGLE_MASK;
  }
}

export function tickExplosions(state: ExplosionState): void {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.dx;
    p.y += p.dy;
    p.lifetime--;
    if (p.lifetime <= 0) {
      state.particles.splice(i, 1);
    }
  }
}

/** OR two hex colour strings to produce the $FF "both colours" result. */
export function orColours(a: string, b: string): string {
  const av = parseInt(a.slice(1), 16);
  const bv = parseInt(b.slice(1), 16);
  return '#' + (av | bv).toString(16).padStart(6, '0');
}

export function renderExplosions(
  ctx: CanvasRenderingContext2D,
  state: ExplosionState,
  camX: number,
  camY: number,
): void {
  for (const p of state.particles) {
    ctx.fillStyle = p.color;
    const sx = Math.round(p.x * WORLD_SCALE_X - camX);
    const sy = Math.round(p.y * WORLD_SCALE_Y - camY);
    ctx.fillRect(sx, sy, 2, 2);
  }
}
