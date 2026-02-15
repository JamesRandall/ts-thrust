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

import { Model } from "./models";
import { Level } from "./levels";
import { fontData, charIndex, CHAR_W, CHAR_H } from "./font";

export function drawModel(
  ctx: CanvasRenderingContext2D,
  model: Model,
  x: number,
  y: number,
  rotation: number
) {
  for (const polygon of model) {
    const points: Point[] = [];
    for (let i = 0; i < polygon.vertices.length; i += 2) {
      points.push({ x: polygon.vertices[i], y: polygon.vertices[i + 1] });
    }

    // Find center of polygon
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    // Rotate around center and translate to position
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const transformed = points.map(p => ({
      x: x + (p.x - cx) * cos - (p.y - cy) * sin,
      y: y + (p.x - cx) * sin + (p.y - cy) * cos,
    }));

    ctx.fillStyle = polygon.colour;
    for (let i = 0; i < transformed.length; i++) {
      const a = transformed[i];
      const b = transformed[(i + 1) % transformed.length];
      drawLine(ctx, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y));
    }
  }
}

function drawLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

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

export function renderLevel(
  ctx: CanvasRenderingContext2D,
  level: Level,
  playerX: number,
  playerY: number,
  playerRotation: number,
  ship: Model,
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
  drawModel(ctx, ship, Math.round(wx(playerX) - camX), Math.round(wy(playerY) - camY), playerRotation);
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
