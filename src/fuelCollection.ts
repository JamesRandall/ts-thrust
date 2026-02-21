import { Level } from "./levels";
import { GameState } from "./game";

// Fuel collection constants
const FUEL_PICKUP_RANGE_X = 6;
const FUEL_PICKUP_RANGE_Y = 28;
const FUEL_TRACTOR_THRESHOLD = 26;
const FUEL_SCORE = 300;
const FUEL_ADD_PER_TICK = 11;

// Beam rendering constants (screen pixels)
const BEAM_Y_OFFSET = 20;
const BEAM_X_OFFSET = -6;
const BEAM_LENGTH_Y = 30;
const BEAM_LINE1_DX = 10;
const BEAM_LINE2_GAP = 12;
const BEAM_LINE2_DX = 8;

export interface FuelCollectionState {
  tractorCounters: number[];
  collectingFuelIndex: number;
  tickCounter: number;
  collectedThisTick: boolean;
}

export function createFuelCollectionState(numFuel: number): FuelCollectionState {
  return {
    tractorCounters: new Array(numFuel).fill(0),
    collectingFuelIndex: -1,
    tickCounter: 0,
    collectedThisTick: false,
  };
}

export function tickFuelCollection(
  state: FuelCollectionState,
  level: Level,
  playerX: number,
  playerY: number,
  shieldActive: boolean,
  podAttached: boolean,
  destroyedFuel: Set<number>,
  game: GameState,
): void {
  state.collectingFuelIndex = -1;
  state.collectedThisTick = false;

  for (let i = 0; i < level.fuel.length; i++) {
    if (destroyedFuel.has(i)) continue;

    const fuel = level.fuel[i];
    const dx = fuel.x - playerX;
    if (dx <= 0 || dx >= FUEL_PICKUP_RANGE_X) continue;

    const dy = fuel.y - playerY;
    if (Math.abs(dy) >= FUEL_PICKUP_RANGE_Y) continue;

    if (!shieldActive || podAttached) continue;

    state.collectingFuelIndex = i;
    state.tractorCounters[i]++;
    game.fuel += FUEL_ADD_PER_TICK;

    if (state.tractorCounters[i] >= FUEL_TRACTOR_THRESHOLD) {
      destroyedFuel.add(i);
      game.score += FUEL_SCORE;
      state.collectedThisTick = true;
    }

    break;
  }

  state.tickCounter++;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number,
  x1: number, y1: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    ctx.fillRect(cx, cy, 1, 1);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
}

export function renderFuelBeams(
  ctx: CanvasRenderingContext2D,
  state: FuelCollectionState,
  shipScreenX: number,
  shipScreenY: number,
): void {
  if (state.collectingFuelIndex < 0) return;
  if (state.tickCounter % 2 !== 0) return;

  const beamX = shipScreenX + BEAM_X_OFFSET;
  const beamY = shipScreenY + BEAM_Y_OFFSET;

  // Line 1: from (beamX, beamY + 30) to (beamX + 10, beamY)
  drawLine(ctx, beamX, beamY + BEAM_LENGTH_Y, beamX + BEAM_LINE1_DX, beamY, "#ffff00");

  // Line 2: end_x = line1_end_x + 12, start_x = end_x + 8
  const line2EndX = beamX + BEAM_LINE1_DX + BEAM_LINE2_GAP;
  const line2StartX = line2EndX + BEAM_LINE2_DX;
  drawLine(ctx, line2StartX, beamY + BEAM_LENGTH_Y, line2EndX, beamY, "#ffff00");
}
