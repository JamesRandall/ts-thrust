import { ANGLE_X, ANGLE_Y } from "./physics";
import { ExplosionState, spawnExplosion } from "./explosions";
import { Level } from "./levels";

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

  state.tickCounter = (state.tickCounter + 1) & 0xFF;

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
      state.countdownTicks = 32;
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
      state.visible = (state.countdownTicks & 0x04) !== 0;
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
  if (!state.destroyed && state.rechargeCounter === 0 && state.planetCountdown < 0 && (state.tickCounter & 0x0F) === 0) {
    explosions.particles.push({
      x: level.powerPlant.x + 4,
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
  let explosionAngle = Math.floor(Math.random() * 256) & 0x1F;
  for (let p = 0; p < 3; p++) {
    const rndA = Math.floor(Math.random() * 256);
    const rndB = Math.floor(Math.random() * 256);
    const randomOffset = rndA & 0x03;
    const angle = (explosionAngle + randomOffset) & 0x1F;

    const baseDx = ANGLE_X[angle] / 16;
    const baseDy = ANGLE_Y[angle] / 16;
    const magnitude = (rndB & 0x03) + 2;
    const dx = baseDx * magnitude;
    const dy = baseDy * magnitude;

    const lifetimeBase = (magnitude << 3) ^ 0x1F;
    const lifetime = ((rndA & 0x0F) >> 1) + lifetimeBase + 8;

    explosions.particles.push({
      x: bulletX,
      y: bulletY,
      dx,
      dy,
      lifetime,
      color: "#ffffff",
    });

    explosionAngle = (explosionAngle + 4) & 0x1F;
  }

  // Calculate new recharge
  const newRecharge = (Math.floor(Math.random() * 256) & 0x1F) + state.rechargeIncrease;

  if (newRecharge > 255) {
    // Overflow
    if (state.planetCountdown >= 0) {
      // Already counting down
      state.rechargeCounter = 255;
    } else {
      state.rechargeCounter = 255;
      state.planetCountdown = 10;
      state.countdownTicks = 1;
    }
    state.rechargeIncrease = newRecharge & 0xFF;
  } else {
    // No overflow — stun turrets, accumulate damage
    state.rechargeCounter = newRecharge;
    state.rechargeIncrease = newRecharge;
  }
}

export function canTurretsFire(state: GeneratorState): boolean {
  return state.rechargeCounter === 0 && state.planetCountdown < 0;
}
