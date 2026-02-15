export const bbcMicroColours = {
  black:   "#000000",
  red:     "#ff0000",
  green:   "#00ff00",
  yellow:  "#ffff00",
  blue:    "#0000ff",
  magenta: "#ff00ff",
  cyan:    "#00ffff",
  white:   "#ffffff",
} as const;

export interface Point {
  x: number;
  y: number;
}

import { Level, TurretDirection } from "./levels";
import { fontData, charIndex, CHAR_W, CHAR_H } from "./font";
import { TurretSprites } from "./shipSprites";

export function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  parityOffset: number = 0
) {
  if (points.length < 3) return;

  // Find vertical bounds
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const startY = Math.ceil(minY);
  const endY = Math.floor(maxY);

  ctx.fillStyle = color;

  for (let y = startY; y <= endY; y++) {
    // Skip every other line (locked to world coordinates via parityOffset)
    if ((y + parityOffset) % 2 !== 0) continue;

    // Find edge intersections at this scanline
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        intersections.push(a.x + t * (b.x - a.x));
      }
    }

    intersections.sort((a, b) => a - b);

    // Fill between pairs of intersections
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x1 = Math.ceil(intersections[i]);
      const x2 = Math.floor(intersections[i + 1]);
      if (x2 >= x1) {
        ctx.fillRect(x1, y, x2 - x1 + 1, 1);
      }
    }
  }
}

// Terrain X values are byte-column indices from the BBC Micro (1 unit = 2 MODE 2 pixels).
// Our 320px canvas is 2x MODE 2 resolution, so each terrain unit = 4 canvas pixels.
export const WORLD_SCALE_X = 4;
export const WORLD_SCALE_Y = 2;
export const WORLD_WIDTH = 256 * WORLD_SCALE_X;

export function computeCamera(
  playerX: number,
  playerY: number,
  screenW: number,
  screenH: number
): { camX: number; camY: number } {
  return {
    camX: Math.round(playerX * WORLD_SCALE_X - screenW / 2),
    camY: Math.round(playerY * WORLD_SCALE_Y - screenH / 2),
  };
}

export function rotationToSpriteIndex(radians: number): number {
  const twoPi = Math.PI * 2;
  const normalized = ((radians % twoPi) + twoPi) % twoPi;
  return Math.round(normalized / (twoPi / 32)) % 32;
}

const tintCanvas = document.createElement('canvas');
const tintCtx = tintCanvas.getContext('2d')!;

function drawTintedSprite(
  ctx: CanvasRenderingContext2D,
  sprite: ImageBitmap,
  x: number,
  y: number,
  color: string,
) {
  tintCanvas.width = sprite.width;
  tintCanvas.height = sprite.height;
  tintCtx.clearRect(0, 0, sprite.width, sprite.height);
  tintCtx.drawImage(sprite, 0, 0);
  tintCtx.globalCompositeOperation = 'source-atop';
  tintCtx.fillStyle = color;
  tintCtx.fillRect(0, 0, sprite.width, sprite.height);
  tintCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(tintCanvas, x, y);
}

function getTurretSprite(
  direction: TurretDirection,
  sprites: TurretSprites,
): ImageBitmap {
  switch (direction) {
    case 'up_left': return sprites.upLeft;
    case 'up_right': return sprites.upRight;
    case 'down_left': return sprites.downLeft;
    case 'down_right': return sprites.downRight;
  }
}

export function renderLevel(
  ctx: CanvasRenderingContext2D,
  level: Level,
  playerX: number,
  playerY: number,
  playerRotation: number,
  shipSprites: ImageBitmap[],
  screenW: number,
  screenH: number,
  fuelSprite?: ImageBitmap,
  turretSprites?: TurretSprites,
) {
  // Scale world coordinates to screen space
  const wx = (x: number) => x * WORLD_SCALE_X;
  const wy = (y: number) => y * WORLD_SCALE_Y;

  const { camX, camY } = computeCamera(playerX, playerY, screenW, screenH);

  // Convert a world X to a screen X, handling horizontal wrapping
  const toScreenX = (worldX: number) => {
    let sx = wx(worldX) - camX;
    // Wrap into view
    while (sx < -WORLD_WIDTH / 2) sx += WORLD_WIDTH;
    while (sx > WORLD_WIDTH / 2) sx -= WORLD_WIDTH;
    return sx;
  };

  // Draw terrain polygons at three offsets to handle wrapping
  const offsets = [-WORLD_WIDTH, 0, WORLD_WIDTH];
  for (const offset of offsets) {
    for (const poly of level.polygons) {
      const points: Point[] = [];
      for (let i = 0; i < poly.length; i += 2) {
        points.push({ x: wx(poly[i]) - camX + offset, y: wy(poly[i + 1]) - camY });
      }
      fillPolygon(ctx, points, level.terrainColor, Math.round(camY));
    }
  }

  // Draw objects (with wrapping)
  const drawMarker = (ox: number, oy: number, colour: string) => {
    const sx = Math.round(toScreenX(ox));
    const sy = Math.round(wy(oy) - camY);
    ctx.fillStyle = colour;
    ctx.fillRect(sx - 3, sy - 3, 7, 7);
  };

  drawMarker(level.powerPlant.x, level.powerPlant.y, bbcMicroColours.cyan);
  drawMarker(level.podPedestal.x, level.podPedestal.y, bbcMicroColours.white);
  for (const f of level.fuel) {
    if (fuelSprite) {
      const sx = Math.round(toScreenX(f.x));
      const sy = Math.round(wy(f.y) - camY);
      ctx.drawImage(fuelSprite, Math.round(sx - fuelSprite.width / 2), sy - 2);
    } else {
      drawMarker(f.x, f.y, bbcMicroColours.magenta);
    }
  }
  for (const t of level.turrets) {
    if (turretSprites) {
      const sprite = getTurretSprite(t.direction, turretSprites);
      const sx = Math.round(toScreenX(t.x));
      const sy = Math.round(wy(t.y) - camY);
      drawTintedSprite(ctx, sprite, sx, sy, level.turretColor);
    } else {
      drawMarker(t.x, t.y, bbcMicroColours.red);
    }
  }

  // Draw player ship (always at screen center)
  const spriteIdx = rotationToSpriteIndex(playerRotation);
  const sprite = shipSprites[spriteIdx];
  const screenX = Math.round(wx(playerX) - camX);
  const screenY = Math.round(wy(playerY) - camY);
  ctx.drawImage(sprite, Math.round(screenX - sprite.width / 2), Math.round(screenY - sprite.height / 2));
}

export function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  screenW: number,
  fuel: number,
  lives: number,
  score: number
) {
  const scale = 1;
  const charW = CHAR_W * scale;
  const charH = CHAR_H * scale;
  const barHeight = 15;

  // Clear status bar area to black so level content doesn't show through
  ctx.fillStyle = bbcMicroColours.black;
  ctx.fillRect(0, 0, screenW, barHeight + 1);

  // --- Yellow border with chamfered bottom corners ---
  const bL = 2;
  const bR = screenW - 3;
  const bT = 0;
  const bB = barHeight;
  const corner = 5;

  ctx.fillStyle = bbcMicroColours.yellow;
  // Top edge
  ctx.fillRect(bL, bT, bR - bL + 1, 1);
  // Left edge
  ctx.fillRect(bL, bT, 1, bB - bT - corner);
  // Right edge
  ctx.fillRect(bR, bT, 1, bB - bT - corner);
  // Bottom edge
  ctx.fillRect(bL + corner, bB, bR - bL - corner * 2 + 1, 1);
  // Bottom-left diagonal
  for (let i = 0; i <= corner; i++) {
    ctx.fillRect(bL + i, bB - corner + i, 1, 1);
  }
  // Bottom-right diagonal
  for (let i = 0; i <= corner; i++) {
    ctx.fillRect(bR - i, bB - corner + i, 1, 1);
  }

  // --- Label positions ---
  const labelY = 2;
  const fuelX = 9 + 2 * charW;
  const livesX = Math.floor((screenW - 5 * charW) / 2);
  const scoreX = screenW - 9 - 5 * charW - 2 * charW;

  // --- Red decorative double-lines (with gaps for labels) ---
  const rl1 = labelY + 1;
  const rl2 = labelY + 3;
  const gap = 1;

  ctx.fillStyle = bbcMicroColours.red;
  const segments: [number, number][] = [
    [bL + 2, fuelX - gap - 1],
    [fuelX + 4 * charW + gap + 1, livesX - gap - 1],
    [livesX + 5 * charW + gap + 1, scoreX - gap - 1],
    [scoreX + 5 * charW + gap + 1, bR - 1],
  ];
  for (const [x1, x2] of segments) {
    if (x2 > x1) {
      ctx.fillRect(x1, rl1, x2 - x1, 1);
      ctx.fillRect(x1, rl2, x2 - x1, 1);
    }
  }

  // --- Green labels ---
  drawText(ctx, "FUEL", fuelX, labelY, bbcMicroColours.green, scale);
  drawText(ctx, "LIVES", livesX, labelY, bbcMicroColours.green, scale);
  drawText(ctx, "SCORE", scoreX, labelY, bbcMicroColours.green, scale);

  // --- Yellow values ---
  const valueY = labelY + charH + 2;

  const fuelStr = String(fuel);
  const fuelValX = fuelX + 4 * charW - fuelStr.length * charW;
  drawText(ctx, fuelStr, fuelValX, valueY, bbcMicroColours.yellow, scale);

  const livesStr = String(lives);
  const livesValX = livesX + Math.floor((5 * charW - livesStr.length * charW) / 2);
  drawText(ctx, livesStr, livesValX, valueY, bbcMicroColours.yellow, scale);

  const scoreStr = String(score);
  const scoreValX = scoreX + 5 * charW - scoreStr.length * charW;
  drawText(ctx, scoreStr, scoreValX, valueY, bbcMicroColours.yellow, scale);
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: string,
  scale: number = 1
) {
  ctx.fillStyle = colour;
  let cursorX = x;

  for (const ch of text) {
    if (ch === " ") {
      cursorX += CHAR_W * scale;
      continue;
    }

    const idx = charIndex(ch);
    const rows = fontData[idx];

    for (let row = 0; row < CHAR_H; row++) {
      const byte = rows[row];
      for (let col = 0; col < CHAR_W; col++) {
        if (byte & (0x80 >> col)) {
          ctx.fillRect(
            cursorX + col * scale,
            y + row * scale,
            scale,
            scale
          );
        }
      }
    }

    cursorX += CHAR_W * scale;
  }
}
