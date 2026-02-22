import { Level, SpawnPoint, levels } from "./levels";
import { ThrustPhysics, ThrustInput } from "./physics";
import { CollisionResult } from "./collision";
import { ScrollState, ScrollConfig, createScrollConfig, createScrollState, updateScroll } from "./scroll";
import { WORLD_SCALE_X, WORLD_SCALE_Y, bbcMicroColours } from "./rendering";
import { TurretFiringState, createTurretFiringState, tickTurrets, PlayerShootingState, createPlayerShootingState, tickPlayerShooting, tickPlayerBullets } from "./bullets";
import { ExplosionState, createExplosionState, tickExplosions, spawnExplosion } from "./explosions";
import { FuelCollectionState, createFuelCollectionState, tickFuelCollection } from "./fuelCollection";
import { GeneratorState, createGeneratorState, tickGenerator, canTurretsFire } from "./generator";
import { StarFieldState, createStarFieldState, tickStarField, seedStarField } from "./stars";
import { DoorState, createDoorState, tickDoor } from "./doors";
import { GameInput } from "./input";

// Viewport dimensions in world coordinates
const VIEWPORT_W = 320 / WORLD_SCALE_X; // 80
const VIEWPORT_H = 256 / WORLD_SCALE_Y; // 128
const STATUS_BAR_H = 16 / WORLD_SCALE_Y; // 8

// Game loop updates at original tick rate (~33.3 Hz — 3 centiseconds per tick)
const SCROLL_STEP_S = 3 / 100;

// Fuel burn active slots — thrust only burns fuel on these slots (6 of 16)
const FUEL_ACTIVE_SLOTS = new Set([0, 3, 5, 8, 11, 13]);

const TICK_SLOT_MASK = 0x0F;
const SHIELD_GATE_MASK = 0x02;
const BYTE_MASK = 0xFF;
const BONUS_LOOPS_BASE = 5;
const BONUS_LOOPS_PLANET_DESTROYED = 5;
const BONUS_SCORE_PER_LOOP = 400;
const INITIAL_FUEL = 1000;
const EXTRA_LIFE_THRESHOLD = 10000;

// Tractor beam distance thresholds (screen-space approximate distance)
const TRACTOR_BEAM_START_DISTANCE = 0x75;  // 117 — close zone
const TRACTOR_ATTACH_DISTANCE = 0x84;      // 132 — far zone

// Orbit escape altitude — midpoint y < this = escaped (matches original $0120)
const ORBIT_ESCAPE_Y = 288;

// Duration of message overlay in game ticks (~2 seconds at 33 Hz)
export const MESSAGE_DURATION = 66;

// Death sequence constants
const DEATH_TIMER_INITIAL = 0x3C;       // 60 ticks
const DEATH_BACKGROUND_BLACK_AT = 0x28; // 40 — timer value when background darkens
const TETHER_RETRACT_RATE = 2;          // top_nibble_index decremented by 2 per tick
const SHIP_EXPLOSION_X_OFFSET = 4 / WORLD_SCALE_X; // +4 screen pixels → world units
const SHIP_EXPLOSION_Y_OFFSET = 5 / WORLD_SCALE_Y; // +5 screen pixels → world units
const SHIP_EXPLOSION_ANGLE = 0x01;      // fixed starting angle (not random)

export interface DeathSequence {
  timer: number;              // Starts at 60, decrements each tick to 0
  shipDestroyed: boolean;     // Ship has been destroyed (explosion spawned)
  backgroundDarkened: boolean; // Background palette set to black at timer == 40
  midpointYAtDeath: number;   // Midpoint Y when death started (for spawn point selection)
  hadPodAtDeath: boolean;     // Whether pod was attached when death started
}

export interface TeleportAnimation {
  isDisappearing: boolean;  // true = orbit escape, false = level start/retry
  step: number;             // 0-11 (current animation frame)
  timer: number;            // seconds accumulated for frame pacing
  shipCX: number;           // ship center screen X (frozen at anim start)
  shipCY: number;           // ship center screen Y (frozen at anim start)
  podCX: number;            // pod center screen X (frozen)
  podCY: number;            // pod center screen Y (frozen)
  hasPod: boolean;          // pod was attached when animation started
}

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
  doorState: DoorState;
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
  teleport: TeleportAnimation | null;
  gameOver: boolean;
  deathSequence: DeathSequence | null;
  oldShipX: number;
  oldShipY: number;
  reverseGravity: boolean;
  invisibleLandscape: boolean;
}

function selectSpawnPoint(
  level: Level,
  currentMidpointY: number,
  hasPod: boolean,
): { spawnPoint: SpawnPoint; respawnWithPod: boolean } {
  const points = level.spawnPoints;
  let selectedIndex = 0;

  for (let i = 0; i < points.length; i++) {
    if (points[i].midpointY >= currentMidpointY) {
      selectedIndex = i;
      break;
    }
    if (i === points.length - 1) {
      selectedIndex = i;
    }
  }

  let respawnWithPod = false;
  if (hasPod && selectedIndex > 0) {
    selectedIndex--;
    respawnWithPod = true;
  }

  return {
    spawnPoint: points[selectedIndex],
    respawnWithPod,
  };
}

function applySpawnPoint(state: GameState, spawn: SpawnPoint): void {
  state.physics.state.x = spawn.midpointX;
  state.physics.state.y = spawn.midpointY;
  state.player.x = spawn.midpointX;
  state.player.y = spawn.midpointY;
  state.physics.state.shipX = spawn.midpointX;
  state.physics.state.shipY = spawn.midpointY;
  state.oldShipX = spawn.midpointX;
  state.oldShipY = spawn.midpointY;
  const fresh = createScrollState(
    spawn.midpointX,
    spawn.midpointY,
    VIEWPORT_W,
    VIEWPORT_H,
    STATUS_BAR_H,
  );
  state.scroll.windowPos.x = fresh.windowPos.x;
  state.scroll.windowPos.y = fresh.windowPos.y;
}

export function createGame(
  level: Level,
  levelNumber: number = 0,
  persistent?: { lives: number; score: number; missionNumber: number; reverseGravity?: boolean; invisibleLandscape?: boolean },
): GameState {
  const reverseGravity = persistent?.reverseGravity ?? false;
  const invisibleLandscape = persistent?.invisibleLandscape ?? false;
  const startAngle = reverseGravity ? 16 : 0;

  const spawn = level.spawnPoints[0];
  const physics = new ThrustPhysics({
    x: spawn.midpointX,
    y: spawn.midpointY,
    angle: startAngle,
    reverseGravity,
  });

  const scrollConfig = createScrollConfig(VIEWPORT_W, VIEWPORT_H, STATUS_BAR_H);
  const scroll = createScrollState(
      spawn.midpointX,
      spawn.midpointY,
      VIEWPORT_W,
      VIEWPORT_H,
      STATUS_BAR_H,
  );

  const starField = createStarFieldState();
  seedStarField(starField, scroll.windowPos.x, level.objectColor, level.terrainColor);

  const state: GameState = {
    level,
    physics,
    player: {
      x: spawn.midpointX,
      y: spawn.midpointY,
      rotation: (startAngle / 32) * Math.PI * 2,
    },
    fuel: INITIAL_FUEL,
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
    doorState: createDoorState(),
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
    teleport: null,
    gameOver: false,
    deathSequence: null,
    oldShipX: spawn.midpointX,
    oldShipY: spawn.midpointY,
    reverseGravity,
    invisibleLandscape,
  };
  startTeleport(state, false);
  return state;
}

/** Compute and freeze screen positions for the teleport animation. */
export function startTeleport(state: GameState, isDisappearing: boolean): void {
  const camX = Math.round(state.scroll.windowPos.x * WORLD_SCALE_X);
  const camY = Math.round(state.scroll.windowPos.y * WORLD_SCALE_Y);

  const shipCX = Math.round(state.player.x * WORLD_SCALE_X - camX);
  const shipCY = Math.round(state.player.y * WORLD_SCALE_Y - camY);

  let podCX = 0, podCY = 0;
  const hasPod = state.physics.state.podAttached;
  if (hasPod) {
    podCX = Math.round(state.physics.state.podX * WORLD_SCALE_X - camX);
    podCY = Math.round(state.physics.state.podY * WORLD_SCALE_Y - camY);
  }

  state.teleport = {
    isDisappearing,
    step: 0,
    timer: 0,
    shipCX,
    shipCY,
    podCX,
    podCY,
    hasPod,
  };
}

/** Destroy the player's ship — spawns explosion at old position, starts/resets death timer. */
export function destroyPlayerShip(state: GameState): void {
  if (state.deathSequence?.shipDestroyed) return; // guard: only trigger once

  if (!state.deathSequence) {
    state.deathSequence = {
      timer: DEATH_TIMER_INITIAL,
      shipDestroyed: false,
      backgroundDarkened: false,
      midpointYAtDeath: state.physics.state.y,
      hadPodAtDeath: state.physics.state.podAttached,
    };
  }
  state.deathSequence.timer = DEATH_TIMER_INITIAL;
  state.deathSequence.shipDestroyed = true;

  spawnExplosion(
    state.explosions,
    state.oldShipX + SHIP_EXPLOSION_X_OFFSET,
    state.oldShipY + SHIP_EXPLOSION_Y_OFFSET,
    bbcMicroColours.white,
    SHIP_EXPLOSION_ANGLE,
  );
}

/** Destroy the attached pod — detaches, spawns explosion at pod position, resets death timer. */
export function destroyAttachedPod(state: GameState): void {
  if (!state.physics.state.podAttached) return;

  if (!state.deathSequence) {
    state.deathSequence = {
      timer: DEATH_TIMER_INITIAL,
      shipDestroyed: false,
      backgroundDarkened: false,
      midpointYAtDeath: state.physics.state.y,
      hadPodAtDeath: state.physics.state.podAttached,
    };
  }
  state.deathSequence.timer = DEATH_TIMER_INITIAL; // reset timer (key spec behaviour)

  const podX = state.physics.state.podX;
  const podY = state.physics.state.podY;
  state.physics.detachPod();

  spawnExplosion(
    state.explosions,
    podX,
    podY,
    bbcMicroColours.white,
    SHIP_EXPLOSION_ANGLE,
  );
}

/** Per-tick death countdown: retract tether, trigger secondary destruction, end level at 0. */
function tickDeathSequence(state: GameState): void {
  const ds = state.deathSequence!;

  ds.timer--;

  if (ds.timer <= 0) {
    state.levelEndedFlag = true;
    return;
  }

  if (!ds.backgroundDarkened && ds.timer === DEATH_BACKGROUND_BLACK_AT) {
    ds.backgroundDarkened = true;
  }

  // Tether retraction (every tick during countdown)
  state.physics.state.pod.tetherIndex -= TETHER_RETRACT_RATE;

  if (state.physics.state.pod.tetherIndex < 0) {
    // Secondary destruction: whichever hasn't been destroyed yet
    if (!ds.shipDestroyed) {
      destroyPlayerShip(state);
    } else if (state.physics.state.podAttached) {
      destroyAttachedPod(state);
    }
  }
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

export function tick(state: GameState, dt: number, gameInput: GameInput): void {
  const dying = state.deathSequence !== null;

  // Gate input on death sequence — no player control while dying
  const spacebarDown = !dying && gameInput.shieldTractor;
  const thrustDown = !dying && gameInput.thrust;

  // Save old position for death explosion origin (before physics update)
  state.oldShipX = state.player.x;
  state.oldShipY = state.player.y;

  // Gate physics input on fuel AND death
  const input: ThrustInput = {
    thrust: thrustDown && !state.fuelEmpty,
    rotate: dying ? 0 : (gameInput.rotateLeft ? -1 : gameInput.rotateRight ? 1 : 0),
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
  let scrollUpdated = false;
  while (state.scrollAccumulator >= SCROLL_STEP_S) {
    state.scrollAccumulator -= SCROLL_STEP_S;
    scrollUpdated = true;

    // Fuel burn logic per game tick
    const slot = state.fuelTickCounter & TICK_SLOT_MASK;
    const shieldGate = (state.fuelTickCounter & SHIELD_GATE_MASK) !== 0;
    state.fuelTickCounter = (state.fuelTickCounter + 1) & BYTE_MASK;

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

    // Death sequence countdown (runs each game tick)
    if (dying) {
      tickDeathSequence(state);
    }

    updateScroll(
        { x: state.physics.state.x, y: state.physics.state.y },
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
        !dying && gameInput.fire,
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

    tickDoor(state.doorState, state.level.doorConfig);

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

    // Orbit escape detection — blocked during death
    if (!dying && state.physics.state.y < ORBIT_ESCAPE_Y && !state.levelEndedFlag) {
      state.escapedToOrbit = true;
    }
  }

  // Ensure scroll updates at least once per frame to stay in sync with physics.
  // Without this, frames where the 50Hz accumulator doesn't trigger leave the
  // camera stale while ship/pod positions have advanced, causing visible jitter.
  if (!scrollUpdated) {
    updateScroll(
        { x: state.physics.state.x, y: state.physics.state.y },
        { x: state.physics.state.forceX, y: state.physics.state.forceY },
        state.scroll,
        state.scrollConfig,
    );
  }
}

/** Reset level state for retry — preserves score, lives, levelNumber, missionNumber. */
export function retryLevel(state: GameState): void {
  // Detach pod first if attached
  state.physics.detachPod();

  const ds = state.deathSequence;
  const { spawnPoint, respawnWithPod } = selectSpawnPoint(
    state.level,
    ds ? ds.midpointYAtDeath : state.physics.state.y,
    ds ? ds.hadPodAtDeath : false,
  );

  const startAngle = state.reverseGravity ? 16 : 0;
  state.player.rotation = (startAngle / 32) * Math.PI * 2;
  state.physics.state.angle = startAngle;
  state.physics.resetMotion();
  state.collisionResult = CollisionResult.None;

  applySpawnPoint(state, spawnPoint);

  if (respawnWithPod) {
    state.physics.state.podAttached = true;
    state.physics.state.pod.angleShipToPod = state.reverseGravity ? 0x11 : 0x01;
    state.physics.state.pod.angleFrac = 0;
    state.physics.state.pod.angularVelocity = 0;
    state.physics.state.pod.tetherIndex = 15;
  }

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
  state.doorState = createDoorState();
  state.starField = createStarFieldState();
  seedStarField(state.starField, state.scroll.windowPos.x, state.level.objectColor, state.level.terrainColor);
  state.fuel = INITIAL_FUEL;
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
  state.teleport = null;
  state.deathSequence = null;
  startTeleport(state, false);
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

/** Advance to next level, preserving persistent state. Toggles cycling modifiers on wrap. */
export function advanceToNextLevel(state: GameState): GameState {
  const nextLevelNumber = (state.levelNumber + 1) % levels.length;

  let reverseGravity = state.reverseGravity;
  let invisibleLandscape = state.invisibleLandscape;

  // Level cycling: toggle modifiers when wrapping from level 5 back to 0
  if (nextLevelNumber === 0 && state.levelNumber === levels.length - 1) {
    reverseGravity = !reverseGravity;
    if (!reverseGravity) {
      // Reverse gravity just turned OFF → toggle invisible landscape
      invisibleLandscape = !invisibleLandscape;
    }
  }

  const newState = createGame(levels[nextLevelNumber], nextLevelNumber, {
    lives: state.lives,
    score: state.score,
    missionNumber: state.missionNumber,
    reverseGravity,
    invisibleLandscape,
  });

  // Show modifier message on first activation of each cycle
  if (reverseGravity && !state.reverseGravity) {
    triggerMessage(newState, "REVERSE GRAVITY", null);
  } else if (invisibleLandscape && !state.invisibleLandscape) {
    triggerMessage(newState, "INVISIBLE LANDSCAPE", null);
  }

  return newState;
}

/** Add points and award extra lives for each 10,000-point boundary crossed. */
export function addScore(state: GameState, points: number): void {
  const oldThousands = Math.floor(state.score / EXTRA_LIFE_THRESHOLD);
  state.score += points;
  const newThousands = Math.floor(state.score / EXTRA_LIFE_THRESHOLD);
  state.lives += (newThousands - oldThousands);
}

/** Apply mission complete bonus scoring and extra lives. */
export function missionComplete(state: GameState): void {
  state.missionNumber++;
  let loopCount = state.levelNumber + BONUS_LOOPS_BASE;
  if (state.generator.planetCountdown >= 0) loopCount += BONUS_LOOPS_PLANET_DESTROYED;
  for (let i = 0; i < loopCount; i++) {
    addScore(state, BONUS_SCORE_PER_LOOP);
  }
}