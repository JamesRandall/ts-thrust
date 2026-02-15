import { DecodedSprite } from "./types";
import { shipSprites, shieldSprite, podSprite } from "./ShipSpriteData";

const SHIELD_SPRITE_ID = 100;
const POD_SPRITE_ID = 101;

/**
 * Decode a Thrust sprite byte array into pixel positions.
 *
 * The sprite format uses two byte types:
 *   - Control bytes (0x80-0x9F): advance to the next row (Y++)
 *   - Pixel bytes (0x00-0x7F): place a pixel on the current row
 *   - 0xFF: end of sprite
 *
 * Each pixel byte encodes a horizontal position via an adjusted value.
 * For normal sprites: adjusted = (byte ^ 0x1F) + 1  (EOR flips bits)
 * For mirrored sprites: adjusted = byte + 1  (no EOR)
 *
 * The offset is subtracted from the screen pointer in the original 6502 code,
 * so we flip X after decoding to get the correct orientation.
 */
function decodeSpriteBytes(
  data: Uint8Array,
  mirrored: boolean
): Array<{ x: number; y: number }> {
  const pixels: Array<{ x: number; y: number }> = [];
  let y = 0;

  for (let i = 0; i < data.length; i++) {
    const b = data[i];

    if (b === 0xFF) break;

    if (b >= 0x80) {
      // Control byte: advance to the next row
      y++;
      continue;
    }

    // Pixel data byte (0x00-0x7F)
    let adjusted: number;
    if (!mirrored) {
      adjusted = (b ^ 0x1F) + 1;
    } else {
      adjusted = b + 1;
    }

    pixels.push({ x: adjusted, y });
  }

  return pixels;
}

function decodeSpriteToGrid(data: Uint8Array, mirrored: boolean): DecodedSprite {
  const pixels = decodeSpriteBytes(data, mirrored);

  if (pixels.length === 0) {
    return { pixels: [], width: 0, height: 0 };
  }

  // Flip X: the original 6502 code subtracts the offset from the screen pointer,
  // so larger adjusted values go further LEFT. We flip to get correct screen orientation.
  let maxX = 0;
  for (const p of pixels) {
    if (p.x > maxX) maxX = p.x;
  }
  for (const p of pixels) {
    p.x = maxX - p.x;
  }

  // Normalize: shift all pixels so top-left is (0,0)
  let minX = Infinity, minY = Infinity;
  let maxXn = -Infinity, maxY = -Infinity;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxXn) maxXn = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const normalized = pixels.map(p => ({ x: p.x - minX, y: p.y - minY }));

  return {
    pixels: normalized,
    width: maxXn - minX + 1,
    height: maxY - minY + 1,
  };
}

export function decodeAllSprites(): Map<number, DecodedSprite> {
  const result = new Map<number, DecodedSprite>();

  // Angles 0-16: use sprites directly (normal decoding with EOR)
  for (let angle = 0; angle <= 16; angle++) {
    result.set(angle, decodeSpriteToGrid(shipSprites[angle], false));
  }

  // Angles 17-31: mirrored versions of sprites 15 down to 1
  for (let angle = 17; angle <= 31; angle++) {
    const sourceSprite = 32 - angle;
    result.set(angle, decodeSpriteToGrid(shipSprites[sourceSprite], true));
  }

  // Shield and pod
  result.set(SHIELD_SPRITE_ID, decodeSpriteToGrid(shieldSprite, false));
  result.set(POD_SPRITE_ID, decodeSpriteToGrid(podSprite, false));

  return result;
}

export { SHIELD_SPRITE_ID, POD_SPRITE_ID };
