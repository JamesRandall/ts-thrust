import { Level } from "./levels";
import { Physics, ThrustInput } from "./physics";

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
}

export function createGame(level: Level): GameState {
  const physics = new Physics({
    x: level.startingPosition.x,
    y: level.startingPosition.y,
  });

  return {
    level,
    physics,
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
  const input: ThrustInput = {
    thrust: keys.has("KeyW"),
    rotate: keys.has("KeyA") ? -1 : keys.has("KeyD") ? 1 : 0,
    shield: false,
  };

  state.physics.update(dt, input);

  state.player.x = state.physics.state.x;
  state.player.y = state.physics.state.y;
  state.player.rotation = state.physics.angleRadians;
}
