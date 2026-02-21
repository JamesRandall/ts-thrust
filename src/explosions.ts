import { ANGLE_X, ANGLE_Y } from "./physics";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";

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
  let explosionAngle = startAngle !== undefined ? (startAngle & 0x1F) : (randomByte() & 0x1F);

  for (let p = 0; p < 8; p++) {
    const rndA = randomByte();
    const rndB = randomByte();

    // Random offset 0–3 added to angle
    const randomOffset = rndA & 0x03;
    const angle = (explosionAngle + randomOffset) & 0x1F;

    // Base velocity from angle tables, divided by 16
    const baseDx = ANGLE_X[angle] / 16;
    const baseDy = ANGLE_Y[angle] / 16;

    // Magnitude = 2–5×
    const magnitude = (rndB & 0x03) + 2;
    const dx = baseDx * magnitude;
    const dy = baseDy * magnitude;

    // Lifetime: inverse correlation with speed
    // (magnitude << 3) ^ 0x1F gives higher values for lower magnitudes
    const lifetimeBase = (magnitude << 3) ^ 0x1F;
    const lifetime = ((rndA & 0x0F) >> 1) + lifetimeBase + 8;

    // 2-step initial kick
    const x = worldX + dx * 2;
    const y = worldY + dy * 2;

    state.particles.push({ x, y, dx, dy, lifetime, color });

    // Advance explosion angle by 4 per particle (8×4 = 32, full circle)
    explosionAngle = (explosionAngle + 4) & 0x1F;
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
