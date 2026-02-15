import { Level } from "./levels";

export interface GameState {
  level: Level;
  player: {
    x: number;
    y: number;
    rotation: number;
  };
  fuel: number;
  lives: number;
  score: number;
}

const MOVE_SPEED = 60;
const FULL_ROTATION_TIME = 1.3;
const ROTATION_SPEED = (Math.PI * 2) / FULL_ROTATION_TIME;

export function createGame(level: Level): GameState {
  return {
    level,
    player: {
      x: level.startingPosition.x,
      y: level.startingPosition.y,
      rotation: 0,
    },
    fuel: 0,
    lives: 0,
    score: 0,
  };
}

export function tick(state: GameState, dt: number, keys: Set<string>): void {
  if (keys.has("KeyA")) state.player.rotation -= ROTATION_SPEED * dt;
  if (keys.has("KeyD")) state.player.rotation += ROTATION_SPEED * dt;

  if (keys.has("ArrowLeft"))  state.player.x -= MOVE_SPEED * dt;
  if (keys.has("ArrowRight")) state.player.x += MOVE_SPEED * dt;
  if (keys.has("ArrowUp"))    state.player.y -= MOVE_SPEED * dt;
  if (keys.has("ArrowDown"))  state.player.y += MOVE_SPEED * dt;
}
