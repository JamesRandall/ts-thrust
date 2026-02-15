import { Level } from "./levels";
import { Physics, ThrustInput } from "./physics";
import { CollisionResult } from "./collision";

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
    fuel: 1000,
    lives: 3,
    score: 0,
    collisionResult: CollisionResult.None,
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

export function resetGame(state: GameState): void {
  state.player.x = state.level.startingPosition.x;
  state.player.y = state.level.startingPosition.y;
  state.player.rotation = 0;
  state.physics.state.x = state.level.startingPosition.x;
  state.physics.state.y = state.level.startingPosition.y;
  state.physics.state.angle = 0;
  state.physics.resetMotion();
  state.collisionResult = CollisionResult.None;
}
