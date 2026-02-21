import { ANGLE_X, ANGLE_Y } from "./physics";
import { ExplosionState, spawnExplosion } from "./explosions";
import { Level } from "./levels";

const BYTE_MASK = 0xFF;
const COUNTDOWN_FLASH_MASK = 0x04;
const SMOKE_INTERVAL_MASK = 0x0F;
const ANGLE_MASK = 0x1F;
const RANDOM_OFFSET_MASK = 0x03;
const MAGNITUDE_MASK = 0x03;
const MAGNITUDE_BASE = 2;
const LIFETIME_XOR_MASK = 0x1F;
const LIFETIME_NIBBLE_MASK = 0x0F;
const EXPLOSION_ANGLE_STEP = 4;
const EXPLOSION_VELOCITY_DIVISOR = 16;
const GENERATOR_HIT_DEBRIS_COUNT = 3;
const RECHARGE_RANDOM_MASK = 0x1F;
const RECHARGE_MAX = 255;
const PLANET_COUNTDOWN_SECONDS = 10;
const COUNTDOWN_TICKS_PER_SECOND = 32;
const GENERATOR_SMOKE_OFFSET_X = 4;

export interface GeneratorState {
  rechargeCounter: number;      // 0–255; while > 0 guns disabled
  rechargeIncrease: number;     // cumulative damage accumulator (init 50)
  planetCountdown: number;      // -1 = inactive, 10→0 = seconds remaining
  countdownTicks: number;       // sub-second counter (32 ticks per second)
  destroyed: boolean;           // removed from level (no-overflow hit)
  visible: boolean;             // toggled during countdown flash
  tickCounter: number;          // for smoke interval + recharge decrement
  countdownBeepThisTick: boolean;
}

export function createGeneratorState(): GeneratorState {
  return {
    rechargeCounter: 15,
    rechargeIncrease: 50,
    planetCountdown: -1,
    countdownTicks: 0,
    destroyed: false,
    visible: true,
    tickCounter: 0,
    countdownBeepThisTick: false,
  };
}

export function tickGenerator(
  state: GeneratorState,
  explosions: ExplosionState,
  level: Level,
  destroyedTurrets: Set<number>,
  destroyedFuel: Set<number>,
): { playerKilled: boolean } {
  let playerKilled = false;
  state.countdownBeepThisTick = false;

  state.tickCounter = (state.tickCounter + 1) & BYTE_MASK;

  // Recharge decrement: every other tick
  if ((state.tickCounter & 1) === 0) {
    if (state.rechargeCounter > 0) {
      state.rechargeCounter--;
    }
    if (state.rechargeIncrease > 0) {
      state.rechargeIncrease--;
    }
  }

  // Planet countdown
  if (state.planetCountdown >= 0) {
    state.countdownTicks--;
    if (state.countdownTicks < 0) {
      state.countdownTicks = COUNTDOWN_TICKS_PER_SECOND;
      if (state.planetCountdown > 0) {
        state.planetCountdown--;
        state.countdownBeepThisTick = true;
      }
    }
    if (state.planetCountdown === 0) {
      playerKilled = true;
    }

    // Flash: if not destroyed and countdown still active
    if (!state.destroyed && state.planetCountdown > 0) {
      state.visible = (state.countdownTicks & COUNTDOWN_FLASH_MASK) !== 0;
    }

    // Object cascade: destroy one non-destroyed turret and one non-destroyed fuel per tick
    for (let i = 0; i < level.turrets.length; i++) {
      if (!destroyedTurrets.has(i)) {
        destroyedTurrets.add(i);
        const t = level.turrets[i];
        spawnExplosion(explosions, t.x + 2, t.y + 4, "#ffff00");
        break;
      }
    }
    for (let i = 0; i < level.fuel.length; i++) {
      if (!destroyedFuel.has(i)) {
        destroyedFuel.add(i);
        const f = level.fuel[i];
        spawnExplosion(explosions, f.x + 2, f.y + 4, "#ffff00");
        break;
      }
    }
  }

  // Smoke: if not destroyed, rechargeCounter === 0, planetCountdown < 0, every 16 ticks
  if (!state.destroyed && state.rechargeCounter === 0 && state.planetCountdown < 0 && (state.tickCounter & SMOKE_INTERVAL_MASK) === 0) {
    explosions.particles.push({
      x: level.powerPlant.x + GENERATOR_SMOKE_OFFSET_X,
      y: level.powerPlant.y - 1.5,
      dx: 0,
      dy: -0.2,
      lifetime: 20,
      color: level.objectColor,
    });
  }

  return { playerKilled };
}

export function handleGeneratorHit(
  state: GeneratorState,
  explosions: ExplosionState,
  bulletX: number,
  bulletY: number,
): void {
  // Spawn 3-particle debris explosion at bullet position
  let explosionAngle = Math.floor(Math.random() * 256) & ANGLE_MASK;
  for (let p = 0; p < GENERATOR_HIT_DEBRIS_COUNT; p++) {
    const rndA = Math.floor(Math.random() * 256);
    const rndB = Math.floor(Math.random() * 256);
    const randomOffset = rndA & RANDOM_OFFSET_MASK;
    const angle = (explosionAngle + randomOffset) & ANGLE_MASK;

    const baseDx = ANGLE_X[angle] / EXPLOSION_VELOCITY_DIVISOR;
    const baseDy = ANGLE_Y[angle] / EXPLOSION_VELOCITY_DIVISOR;
    const magnitude = (rndB & MAGNITUDE_MASK) + MAGNITUDE_BASE;
    const dx = baseDx * magnitude;
    const dy = baseDy * magnitude;

    const lifetimeBase = (magnitude << 3) ^ LIFETIME_XOR_MASK;
    const lifetime = ((rndA & LIFETIME_NIBBLE_MASK) >> 1) + lifetimeBase + 8;

    explosions.particles.push({
      x: bulletX,
      y: bulletY,
      dx,
      dy,
      lifetime,
      color: "#ffffff",
    });

    explosionAngle = (explosionAngle + EXPLOSION_ANGLE_STEP) & ANGLE_MASK;
  }

  // Calculate new recharge
  const newRecharge = (Math.floor(Math.random() * 256) & RECHARGE_RANDOM_MASK) + state.rechargeIncrease;

  if (newRecharge > RECHARGE_MAX) {
    // Overflow
    if (state.planetCountdown >= 0) {
      // Already counting down
      state.rechargeCounter = RECHARGE_MAX;
    } else {
      state.rechargeCounter = RECHARGE_MAX;
      state.planetCountdown = PLANET_COUNTDOWN_SECONDS;
      state.countdownTicks = 1;
    }
    state.rechargeIncrease = newRecharge & BYTE_MASK;
  } else {
    // No overflow — stun turrets, accumulate damage
    state.rechargeCounter = newRecharge;
    state.rechargeIncrease = newRecharge;
  }
}

export function canTurretsFire(state: GeneratorState): boolean {
  return state.rechargeCounter === 0 && state.planetCountdown < 0;
}
