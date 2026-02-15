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

import { Level } from "./levels";
import { fontData, charIndex, CHAR_W, CHAR_H } from "./font";

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
const WORLD_SCALE_X = 4;
const WORLD_SCALE_Y = 2;
const WORLD_WIDTH = 256 * WORLD_SCALE_X;

function rotationToSpriteIndex(radians: number): number {
  const twoPi = Math.PI * 2;
  const normalized = ((radians % twoPi) + twoPi) % twoPi;
  return Math.round(normalized / (twoPi / 32)) % 32;
}

export function renderLevel(
  ctx: CanvasRenderingContext2D,
  level: Level,
  playerX: number,
  playerY: number,
  playerRotation: number,
  shipSprites: ImageBitmap[],
  screenW: number,
  screenH: number
) {
  // Scale world coordinates to screen space
  const wx = (x: number) => x * WORLD_SCALE_X;
  const wy = (y: number) => y * WORLD_SCALE_Y;

  // Camera: always centered on the player, snapped to integer pixels
  // so terrain scanlines don't shimmer
  const camX = Math.round(wx(playerX) - screenW / 2);
  const camY = Math.round(wy(playerY) - screenH / 2);

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
    drawMarker(f.x, f.y, bbcMicroColours.magenta);
  }
  for (const t of level.turrets) {
    drawMarker(t.x, t.y, bbcMicroColours.red);
  }

  // Draw player ship (always at screen center)
  const spriteIdx = rotationToSpriteIndex(playerRotation);
  const sprite = shipSprites[spriteIdx];
  const screenX = Math.round(wx(playerX) - camX);
  const screenY = Math.round(wy(playerY) - camY);
  ctx.drawImage(sprite, Math.round(screenX - sprite.width / 2), Math.round(screenY - sprite.height / 2));
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
