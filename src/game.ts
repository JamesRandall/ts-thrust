import { Level, levels } from "./levels";
import { ThrustPhysics, ThrustInput } from "./physics";
import { CollisionResult } from "./collision";
import { ScrollState, ScrollConfig, createScrollConfig, createScrollState, updateScroll } from "./scroll";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";
import { TurretFiringState, createTurretFiringState, tickTurrets, PlayerShootingState, createPlayerShootingState, tickPlayerShooting, tickPlayerBullets } from "./bullets";
import { ExplosionState, createExplosionState, tickExplosions } from "./explosions";
import { FuelCollectionState, createFuelCollectionState, tickFuelCollection } from "./fuelCollection";
import { GeneratorState, createGeneratorState, tickGenerator, canTurretsFire } from "./generator";
import { StarFieldState, createStarFieldState, tickStarField, seedStarField } from "./stars";

// Viewport dimensions in world coordinates
const VIEWPORT_W = 320 / WORLD_SCALE_X; // 80
const VIEWPORT_H = 256 / WORLD_SCALE_Y; // 128
const STATUS_BAR_H = 16 / WORLD_SCALE_Y; // 8

// Game loop updates at original tick rate (~33.3 Hz — 3 centiseconds per tick)
const SCROLL_STEP_S = 3 / 100;

// Fuel burn active slots — thrust only burns fuel on these slots (6 of 16)
const FUEL_ACTIVE_SLOTS = new Set([0, 3, 5, 8, 11, 13]);

// Tractor beam distance thresholds (screen-space approximate distance)
const TRACTOR_BEAM_START_DISTANCE = 0x75;  // 117 — close zone
const TRACTOR_ATTACH_DISTANCE = 0x84;      // 132 — far zone

// Orbit escape altitude — midpoint y < this = escaped (matches original $0120)
const ORBIT_ESCAPE_Y = 288;

// Duration of message overlay in game ticks (~2 seconds at 33 Hz)
export const MESSAGE_DURATION = 66;

export type PendingAction = 'retry' | 'next-level' | 'game-over' | null;

export interface GameState {
  level: Level;
  physics: ThrustPhysics;
  player: {
    x: number;
    y: number;
    rotation: number;
  };
  fuel: number;
  lives: number;
  score: number;
  collisionResult: CollisionResult;
  shieldActive: boolean;
  scroll: ScrollState;
  scrollConfig: ScrollConfig;
  scrollAccumulator: number;
  turretFiring: TurretFiringState;
  playerShooting: PlayerShootingState;
  destroyedTurrets: Set<number>;
  destroyedFuel: Set<number>;
  explosions: ExplosionState;
  fuelCollection: FuelCollectionState;
  generator: GeneratorState;
  starField: StarFieldState;
  planetKilled: boolean;
  tractorBeamStarted: boolean;
  podLineExists: boolean;
  fuelTickCounter: number;
  fuelEmpty: boolean;
  levelNumber: number;
  missionNumber: number;
  levelEndedFlag: boolean;
  escapedToOrbit: boolean;
  messageText: string | null;
  messageTimer: number;
  pendingAction: PendingAction;
  gameOver: boolean;
}

export function createGame(
  level: Level,
  levelNumber: number = 0,
  persistent?: { lives: number; score: number; missionNumber: number },
): GameState {
  const physics = new ThrustPhysics({
    x: level.startingPosition.x,
    y: level.startingPosition.y,
  });

  const scrollConfig = createScrollConfig(VIEWPORT_W, VIEWPORT_H, STATUS_BAR_H);
  const scroll = createScrollState(
      level.startingPosition.x,
      level.startingPosition.y,
      VIEWPORT_W,
      VIEWPORT_H,
      STATUS_BAR_H,
  );

  const starField = createStarFieldState();
  seedStarField(starField, scroll.windowPos.x, level.objectColor, level.terrainColor);

  return {
    level,
    physics,
    player: {
      x: level.startingPosition.x,
      y: level.startingPosition.y,
      rotation: 0,
    },
    fuel: 1000,
    lives: persistent?.lives ?? 3,
    score: persistent?.score ?? 0,
    collisionResult: CollisionResult.None,
    shieldActive: false,
    scroll,
    scrollConfig,
    scrollAccumulator: 0,
    turretFiring: createTurretFiringState(),
    playerShooting: createPlayerShootingState(),
    destroyedTurrets: new Set(),
    destroyedFuel: new Set(),
    explosions: createExplosionState(),
    fuelCollection: createFuelCollectionState(level.fuel.length),
    generator: createGeneratorState(),
    starField,
    planetKilled: false,
    tractorBeamStarted: false,
    podLineExists: false,
    fuelTickCounter: 0,
    fuelEmpty: false,
    levelNumber,
    missionNumber: persistent?.missionNumber ?? 0,
    levelEndedFlag: false,
    escapedToOrbit: false,
    messageText: null,
    messageTimer: 0,
    pendingAction: null,
    gameOver: false,
  };
}

/** Approximate Manhattan-weighted distance matching the original 6502 routine. */
function tractorDistance(
    shipSX: number, shipSY: number,
    podSX: number, podSY: number,
): number {
  let dy = Math.abs(Math.round(shipSY) - Math.round(podSY));
  let dx = Math.abs(Math.round(shipSX) - Math.round(podSX));
  if (dx > 255 || dy > 255) return 255;
  // d ≈ min + 3*max
  if (dx < dy) { const tmp = dx; dx = dy; dy = tmp; }
  const d = dy + 3 * dx;
  return d > 255 ? 255 : d;
}

export function tick(state: GameState, dt: number, keys: Set<string>): void {
  // Read raw key state
  const spacebarDown = keys.has("Space");
  const thrustDown = keys.has("KeyW");

  // Gate physics input on fuel
  const input: ThrustInput = {
    thrust: thrustDown && !state.fuelEmpty,
    rotate: keys.has("KeyA") ? -1 : keys.has("KeyD") ? 1 : 0,
    shield: spacebarDown && !state.fuelEmpty,
  };

  state.physics.update(dt, input);

  // Use shipX/shipY — equals x,y when no pod, derived from midpoint when attached
  state.player.x = state.physics.state.shipX;
  state.player.y = state.physics.state.shipY;
  state.player.rotation = state.physics.angleRadians;

  // Update scroll at 50 Hz fixed timestep
  const scrollDt = Math.min(dt, 0.1);
  state.scrollAccumulator += scrollDt;
  while (state.scrollAccumulator >= SCROLL_STEP_S) {
    state.scrollAccumulator -= SCROLL_STEP_S;

    // Fuel burn logic per game tick
    const slot = state.fuelTickCounter & 0x0F;
    const shieldGate = (state.fuelTickCounter & 0x02) !== 0;
    state.fuelTickCounter = (state.fuelTickCounter + 1) & 0xFF;

    // Thrust fuel: burns on active slots only (6/16 ticks)
    if (thrustDown && !state.fuelEmpty && FUEL_ACTIVE_SLOTS.has(slot)) {
      state.fuel--;
    }
    // Shield fuel: burns when shield gate is open (2-on/2-off pattern, 50%)
    if (spacebarDown && !state.fuelEmpty && shieldGate) {
      state.fuel--;
    }
    // Check for empty
    if (state.fuel <= 0) {
      state.fuel = 0;
      state.fuelEmpty = true;
    }

    // Shield active flickers with the gate (2-on/2-off)
    state.shieldActive = spacebarDown && !state.fuelEmpty && shieldGate;

    updateScroll(
        { x: state.player.x, y: state.player.y },
        { x: state.physics.state.forceX, y: state.physics.state.forceY },
        state.scroll,
        state.scrollConfig,
    );

    const camX = Math.round(state.scroll.windowPos.x * WORLD_SCALE_X);
    const camY = Math.round(state.scroll.windowPos.y * WORLD_SCALE_Y);
    tickTurrets(
        state.turretFiring,
        state.level,
        state.player.x,
        state.player.y,
        camX,
        camY,
        320,
        256,
        state.destroyedTurrets,
        !canTurretsFire(state.generator),
    );

    tickPlayerShooting(
        state.playerShooting,
        keys.has("Enter"),
        state.shieldActive,
        state.physics.state.angle,
        state.player.x,
        state.player.y,
        state.physics.state.forceX,
        state.physics.state.forceY,
    );

    tickPlayerBullets(state.playerShooting);

    tickExplosions(state.explosions);

    tickStarField(
        state.starField,
        state.scroll.windowPos.x,
        state.scroll.windowPos.y,
        state.level.objectColor,
        state.level.terrainColor,
    );

    const genResult = tickGenerator(state.generator, state.explosions, state.level, state.destroyedTurrets, state.destroyedFuel);
    if (genResult.playerKilled) {
      state.planetKilled = true;
    }

    // Pass spacebarDown && !fuelEmpty so tractor-beam fuel pickup isn't interrupted by shield flicker
    tickFuelCollection(
        state.fuelCollection,
        state.level,
        state.player.x,
        state.player.y,
        spacebarDown && !state.fuelEmpty,
        state.physics.state.podAttached,
        state.destroyedFuel,
        state,
    );

    // Tractor beam logic (50Hz) — gate on spacebarDown && !fuelEmpty (not shieldActive) to avoid flicker reset
    if (!state.physics.state.podAttached) {
      if (!(spacebarDown && !state.fuelEmpty)) {
        // Spacebar released or fuel empty: reset beam
        state.tractorBeamStarted = false;
        state.podLineExists = false;
      } else {
        // Calculate screen-space distance to pod circle center
        // Pod stand sprite (11x19) drawn at (pedestal.x, pedestal.y - 1 screen px)
        // Pod circle (11x11) sits at the top — center at pixel (5, 5) from sprite origin
        const shipSX = state.player.x * WORLD_SCALE_X - camX;
        const shipSY = state.player.y * WORLD_SCALE_Y - camY;
        const podSX = state.level.podPedestal.x * WORLD_SCALE_X - camX + 5;
        const podSY = state.level.podPedestal.y * WORLD_SCALE_Y - camY + 4;

        // Pod must be on screen
        if (podSX >= 0 && podSX < 320 && podSY >= 0 && podSY < 256) {
          const dist = tractorDistance(shipSX, shipSY, podSX, podSY);

          if (dist < TRACTOR_BEAM_START_DISTANCE) {
            // Close zone: start beam
            state.tractorBeamStarted = true;
            state.podLineExists = true;
          } else if (dist >= TRACTOR_ATTACH_DISTANCE && state.tractorBeamStarted) {
            // Far zone + beam started: attach pod at circle center
            const podWorldX = state.level.podPedestal.x + 5 / WORLD_SCALE_X;
            const podWorldY = state.level.podPedestal.y + 4 / WORLD_SCALE_Y;
            state.physics.attachPod(podWorldX, podWorldY);
            state.podLineExists = true;
          }
          // Dead zone ($75-$83): no change
        }

        // podLineExists flickers with shieldActive for rendering
        state.podLineExists = state.tractorBeamStarted && state.shieldActive;
      }
    }

    // Orbit escape detection
    if (state.physics.state.y < ORBIT_ESCAPE_Y && !state.levelEndedFlag) {
      state.escapedToOrbit = true;
    }
  }
}

/** Reset level state for retry — preserves score, lives, levelNumber, missionNumber. */
export function retryLevel(state: GameState): void {
  // Detach pod first if attached
  state.physics.detachPod();

  state.player.x = state.level.startingPosition.x;
  state.player.y = state.level.startingPosition.y;
  state.player.rotation = 0;
  state.physics.state.x = state.level.startingPosition.x;
  state.physics.state.y = state.level.startingPosition.y;
  state.physics.state.shipX = state.level.startingPosition.x;
  state.physics.state.shipY = state.level.startingPosition.y;
  state.physics.state.angle = 0;
  state.physics.resetMotion();
  state.collisionResult = CollisionResult.None;

  // Reset scroll centered on starting position
  const fresh = createScrollState(
      state.level.startingPosition.x,
      state.level.startingPosition.y,
      VIEWPORT_W,
      VIEWPORT_H,
      STATUS_BAR_H,
  );
  state.scroll.windowPos.x = fresh.windowPos.x;
  state.scroll.windowPos.y = fresh.windowPos.y;
  state.scroll.scrollSpeed.x = 0;
  state.scroll.scrollSpeed.y = 0;
  state.scrollAccumulator = 0;
  state.turretFiring.bullets = [];
  for (const b of state.playerShooting.bullets) b.active = false;
  state.playerShooting.bulletIndex = 0;
  state.playerShooting.pressedFire = false;
  state.destroyedTurrets.clear();
  state.destroyedFuel.clear();
  state.explosions.particles = [];
  state.fuelCollection = createFuelCollectionState(state.level.fuel.length);
  state.generator = createGeneratorState();
  state.starField = createStarFieldState();
  seedStarField(state.starField, state.scroll.windowPos.x, state.level.objectColor, state.level.terrainColor);
  state.fuel = 1000;
  state.fuelEmpty = false;
  state.fuelTickCounter = 0;
  state.planetKilled = false;
  state.tractorBeamStarted = false;
  state.podLineExists = false;
  state.levelEndedFlag = false;
  state.escapedToOrbit = false;
  state.messageText = null;
  state.messageTimer = 0;
  state.pendingAction = null;
}

/** Set message overlay and pending action. */
export function triggerMessage(
  state: GameState,
  text: string,
  action: PendingAction,
  duration: number = MESSAGE_DURATION,
): void {
  state.messageText = text;
  state.messageTimer = duration;
  state.pendingAction = action;
}

/** Advance to next level, preserving persistent state. */
export function advanceToNextLevel(state: GameState): GameState {
  const nextLevelNumber = (state.levelNumber + 1) % levels.length;
  return createGame(levels[nextLevelNumber], nextLevelNumber, {
    lives: state.lives,
    score: state.score,
    missionNumber: state.missionNumber,
  });
}

/** Apply mission complete bonus scoring and extra lives. */
export function missionComplete(state: GameState): void {
  state.missionNumber++;
  let loopCount = state.levelNumber + 5;
  if (state.generator.planetCountdown >= 0) loopCount += 5;
  const bonus = loopCount * 400;
  const oldThousands = Math.floor(state.score / 1000);
  state.score += bonus;
  const newThousands = Math.floor(state.score / 1000);
  state.lives += (newThousands - oldThousands);
}