import { Level } from "./levels";
import { Physics, ThrustInput } from "./physics";
import { CollisionResult } from "./collision";
import { ScrollState, ScrollConfig, createScrollConfig, createScrollState, updateScroll } from "./scroll";
import { WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";

// Viewport dimensions in world coordinates
const VIEWPORT_W = 320 / WORLD_SCALE_X; // 80
const VIEWPORT_H = 256 / WORLD_SCALE_Y; // 128
const STATUS_BAR_H = 16 / WORLD_SCALE_Y; // 8

// Scroll updates at original game loop rate (50 Hz)
const SCROLL_STEP_S = 1 / 50;

export interface GameState {
  level: Level;
  physics: Physics;
  player: {
    x: number;
    y: number;
    rotation: number;
  };
  fuel: number;
  lives: number;
  score: number;
  collisionResult: CollisionResult;
  scroll: ScrollState;
  scrollConfig: ScrollConfig;
  scrollAccumulator: number;
}

export function createGame(level: Level): GameState {
  const physics = new Physics({
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

  return {
    level,
    physics,
    player: {
      x: level.startingPosition.x,
      y: level.startingPosition.y,
      rotation: 0,
    },
    fuel: 1000,
    lives: 3,
    score: 0,
    collisionResult: CollisionResult.None,
    scroll,
    scrollConfig,
    scrollAccumulator: 0,
  };
}

export function tick(state: GameState, dt: number, keys: Set<string>): void {
  const input: ThrustInput = {
    thrust: keys.has("KeyW"),
    rotate: keys.has("KeyA") ? -1 : keys.has("KeyD") ? 1 : 0,
    shield: false,
  };

  state.physics.update(dt, input);

  state.player.x = state.physics.state.x;
  state.player.y = state.physics.state.y;
  state.player.rotation = state.physics.angleRadians;

  // Update scroll at 50 Hz fixed timestep
  const scrollDt = Math.min(dt, 0.1);
  state.scrollAccumulator += scrollDt;
  while (state.scrollAccumulator >= SCROLL_STEP_S) {
    state.scrollAccumulator -= SCROLL_STEP_S;
    updateScroll(
      { x: state.player.x, y: state.player.y },
      { x: state.physics.state.forceX, y: state.physics.state.forceY },
      state.scroll,
      state.scrollConfig,
    );
  }
}

export function resetGame(state: GameState): void {
  state.player.x = state.level.startingPosition.x;
  state.player.y = state.level.startingPosition.y;
  state.player.rotation = 0;
  state.physics.state.x = state.level.startingPosition.x;
  state.physics.state.y = state.level.startingPosition.y;
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
}
