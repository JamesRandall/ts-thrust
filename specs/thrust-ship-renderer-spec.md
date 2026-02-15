# Thrust Ship Renderer — Claude Code Spec

## Overview

Recreate the player ship rendering system from the BBC Micro game **Thrust** (Jeremy C. Smith, 1986) using HTML5 Canvas and TypeScript. The original game runs in BBC Micro MODE 1 (320×256, 4 colours) and uses a custom run-length/column-encoded sprite format with 17 pre-rotated ship frames covering 0°–180°, where the remaining 180°–360° range is produced by horizontal mirroring at render time. There are also a shield sprite and a pod sprite.

This spec is derived from a fully annotated 6502 disassembly by Kieran HJ Connell.

---

## 1. Architecture

Create the following files:

```
src/
  thrust-ship/
    ShipSpriteData.ts      — Raw sprite byte arrays + angle lookup tables
    ShipSpriteDecoder.ts   — Decodes the BBC Micro sprite format into pixel grids
    ShipRenderer.ts        — Renders decoded sprites to Canvas
    types.ts               — Shared types
    index.ts               — Demo harness (interactive rotation with keyboard)
```

---

## 2. Types (`types.ts`)

```typescript
/** A decoded sprite as a 2D grid of pixel positions */
export interface DecodedSprite {
  /** Pixel coordinates relative to sprite origin (top-left of bounding box) */
  pixels: Array<{ x: number; y: number }>;
  /** Bounding box width in MODE 1 pixels (each pixel is 2 physical pixels wide) */
  width: number;
  /** Bounding box height in physical pixels */
  height: number;
}

/** Ship angle: 0 = pointing up, 16 ($10) = pointing down, 31 ($1F) = max */
export type ShipAngle = number; // 0–31 inclusive, wraps with AND 0x1F

export interface ShipState {
  /** World x position (sub-pixel precision not needed for rendering) */
  x: number;
  /** World y position */
  y: number;
  /** Current rotation angle (0–31) */
  angle: ShipAngle;
  /** Whether the shield is active */
  shieldActive: boolean;
}
```

---

## 3. Sprite Data (`ShipSpriteData.ts`)

### 3.1 Raw Sprite Byte Arrays

There are **17 ship sprites** (indices 0–16), **1 shield sprite**, and **1 pod sprite**. Each is a byte array terminated by `0xFF`. Export them as typed arrays.

The raw bytes are encoded below exactly as they appear in the disassembly. Copy these verbatim:

```typescript
export const shipSprites: readonly Uint8Array[] = [
  // sprite 0 (angle 0 — pointing straight up)
  new Uint8Array([
    0x10,0x8F,0x11,0x8F,0x11,0x8E,0x12,0x8E,
    0x12,0x8D,0x13,0x8D,0x13,0x8C,0x14,0x8C,
    0x14,0x8A,0x0B,0x15,0x16,0x89,0x17,0x8A,
    0x16,0x8B,0x15,0x8B,0x0F,0x10,0x11,0x15,
    0x8C,0x0E,0x12,0x14,0x8D,0x13,0xFF
  ]),
  // sprite 1
  new Uint8Array([
    0x12,0x91,0x13,0x90,0x13,0x8F,0x13,0x8F,
    0x13,0x8E,0x14,0x8D,0x14,0x8D,0x14,0x8A,
    0x0B,0x0C,0x14,0x89,0x14,0x8A,0x15,0x16,
    0x8A,0x17,0x8B,0x16,0x8B,0x0E,0x0F,0x10,
    0x15,0x8C,0x0D,0x11,0x14,0x92,0x13,0xFF
  ]),
  // sprite 2
  new Uint8Array([
    0x93,0x14,0x92,0x14,0x91,0x14,0x8F,0x10,
    0x14,0x8E,0x14,0x8D,0x14,0x8A,0x0B,0x0C,
    0x14,0x89,0x14,0x89,0x14,0x8A,0x14,0x8A,
    0x15,0x8B,0x16,0x8B,0x0D,0x0E,0x0F,0x15,
    0x8C,0x10,0x13,0x14,0x90,0x12,0x91,0xFF
  ]),
  // sprite 3
  new Uint8Array([
    0x80,0x95,0x16,0x93,0x14,0x16,0x91,0x12,
    0x16,0x90,0x16,0x8B,0x0C,0x0E,0x0F,0x16,
    0x8A,0x0D,0x15,0x8A,0x15,0x8A,0x15,0x8A,
    0x15,0x8A,0x14,0x8B,0x0C,0x0D,0x15,0x8E,
    0x16,0x8F,0x15,0x16,0x8F,0x12,0x13,0x14,
    0x90,0x11,0xFF
  ]),
  // sprite 4
  new Uint8Array([
    0x80,0x80,0x95,0x16,0x17,0x92,0x13,0x14,
    0x17,0x8C,0x10,0x11,0x17,0x8B,0x0D,0x0F,
    0x16,0x8B,0x0E,0x16,0x8B,0x16,0x8A,0x15,
    0x8A,0x15,0x8A,0x14,0x8B,0x0C,0x13,0x8D,
    0x14,0x8E,0x15,0x8E,0x12,0x13,0x14,0x8F,
    0x10,0x11,0xFF
  ]),
  // sprite 5
  new Uint8Array([
    0x80,0x80,0x80,0x8C,0x0D,0x14,0x15,0x16,
    0x17,0x18,0x8C,0x0E,0x10,0x11,0x12,0x13,
    0x18,0x8B,0x0F,0x17,0x8B,0x17,0x8B,0x16,
    0x8A,0x16,0x8A,0x15,0x8B,0x0C,0x14,0x8D,
    0x14,0x8E,0x13,0x8E,0x14,0x8E,0x14,0x8F,
    0x10,0x11,0x12,0x13,0xFF
  ]),
  // sprite 6
  new Uint8Array([
    0x80,0x80,0x80,0x8E,0x8D,0x0F,0x8C,0x10,
    0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,
    0x19,0x8C,0x19,0x8B,0x18,0x8A,0x17,0x8B,
    0x0C,0x16,0x8D,0x16,0x8D,0x15,0x8D,0x14,
    0x8C,0x13,0x8D,0x0E,0x13,0x8F,0x10,0x13,
    0x91,0x12,0xFF
  ]),
  // sprite 7
  new Uint8Array([
    0x80,0x80,0x8F,0x8E,0x10,0x8D,0x10,0x8C,
    0x11,0x12,0x13,0x14,0x15,0x8B,0x16,0x17,
    0x18,0x19,0x8B,0x1A,0x8C,0x19,0x8D,0x18,
    0x8D,0x16,0x17,0x8D,0x15,0x8C,0x13,0x14,
    0x8C,0x12,0x8D,0x0E,0x12,0x8F,0x10,0x12,
    0x91,0xFF
  ]),
  // sprite 8 (pointing right — 90°)
  new Uint8Array([
    0x80,0x80,0x90,0x8F,0x11,0x8D,0x0E,0x11,
    0x8C,0x12,0x13,0x8B,0x14,0x15,0x8C,0x16,
    0x17,0x8D,0x18,0x19,0x8D,0x1A,0x8D,0x18,
    0x19,0x8C,0x16,0x17,0x8B,0x14,0x15,0x8C,
    0x12,0x13,0x8D,0x0E,0x11,0x8F,0x11,0x90,
    0xFF
  ]),
  // sprite 9
  new Uint8Array([
    0x80,0x80,0x91,0x8F,0x10,0x12,0x8D,0x0E,
    0x12,0x8C,0x12,0x8C,0x13,0x14,0x8D,0x15,
    0x8D,0x16,0x17,0x8D,0x18,0x8C,0x19,0x8B,
    0x1A,0x8B,0x16,0x17,0x18,0x19,0x8C,0x11,
    0x12,0x13,0x14,0x15,0x8D,0x10,0x8E,0x10,
    0x8F,0xFF
  ]),
  // sprite 10
  new Uint8Array([
    0x80,0x80,0x91,0x12,0x8F,0x10,0x13,0x8D,
    0x0E,0x13,0x8C,0x13,0x8D,0x14,0x8D,0x15,
    0x8D,0x16,0x8B,0x0C,0x16,0x8A,0x17,0x8B,
    0x18,0x8C,0x19,0x8C,0x10,0x11,0x12,0x13,
    0x14,0x15,0x16,0x17,0x18,0x19,0x8D,0x0F,
    0x8E,0xFF
  ]),
  // sprite 11
  new Uint8Array([
    0x80,0x80,0x80,0x8F,0x10,0x11,0x12,0x13,
    0x8E,0x14,0x8E,0x14,0x8E,0x13,0x8D,0x14,
    0x8B,0x0C,0x14,0x8A,0x15,0x8A,0x16,0x8B,
    0x16,0x8B,0x17,0x8B,0x0F,0x17,0x8C,0x0E,
    0x10,0x11,0x12,0x13,0x18,0x8C,0x0D,0x14,
    0x15,0x16,0x17,0x18,0xFF
  ]),
  // sprite 12
  new Uint8Array([
    0x80,0x80,0x80,0x8F,0x10,0x11,0x8E,0x12,
    0x13,0x14,0x8E,0x15,0x8D,0x14,0x8B,0x0C,
    0x13,0x8A,0x14,0x8A,0x15,0x8A,0x15,0x8B,
    0x16,0x8B,0x0E,0x16,0x8B,0x0D,0x0F,0x16,
    0x8C,0x10,0x11,0x17,0x92,0x13,0x14,0x17,
    0x95,0x16,0x17,0xFF
  ]),
  // sprite 13
  new Uint8Array([
    0x80,0x80,0x80,0x90,0x11,0x8F,0x12,0x13,
    0x14,0x8F,0x15,0x16,0x8E,0x16,0x8B,0x0C,
    0x0D,0x15,0x8A,0x14,0x8A,0x15,0x8A,0x15,
    0x8A,0x15,0x8A,0x0D,0x15,0x8B,0x0C,0x0E,
    0x0F,0x16,0x90,0x16,0x91,0x12,0x16,0x93,
    0x14,0x16,0x95,0x16,0xFF
  ]),
  // sprite 14
  new Uint8Array([
    0x80,0x80,0x80,0x91,0x90,0x12,0x8C,0x10,
    0x13,0x14,0x8B,0x0D,0x0E,0x0F,0x15,0x8B,
    0x16,0x8A,0x15,0x8A,0x14,0x89,0x14,0x89,
    0x14,0x8A,0x0B,0x0C,0x14,0x8D,0x14,0x8E,
    0x14,0x8F,0x10,0x14,0x91,0x14,0x92,0x14,
    0x93,0x14,0xFF
  ]),
  // sprite 15
  new Uint8Array([
    0x80,0x80,0x80,0x80,0x92,0x13,0x8C,0x0D,
    0x11,0x14,0x8B,0x0E,0x0F,0x10,0x15,0x8B,
    0x16,0x8A,0x17,0x8A,0x15,0x16,0x89,0x14,
    0x8A,0x0B,0x0C,0x14,0x8D,0x14,0x8D,0x14,
    0x8E,0x14,0x8F,0x13,0x8F,0x13,0x90,0x13,
    0x91,0x13,0x92,0xFF
  ]),
  // sprite 16 (pointing straight down)
  new Uint8Array([
    0x80,0x80,0x80,0x80,0x8D,0x13,0x8C,0x0E,
    0x12,0x14,0x8B,0x0F,0x10,0x11,0x15,0x8B,
    0x15,0x8A,0x16,0x89,0x17,0x8A,0x0B,0x15,
    0x16,0x8C,0x14,0x8C,0x14,0x8D,0x13,0x8D,
    0x13,0x8E,0x12,0x8E,0x12,0x8F,0x11,0x8F,
    0x11,0x90,0xFF
  ]),
];

export const shieldSprite = new Uint8Array([
  0x80,0x8E,0x0F,0x10,0x11,0x12,0x8C,0x0D,
  0x13,0x14,0x8B,0x15,0x8A,0x16,0x89,0x17,
  0x89,0x17,0x88,0x18,0x88,0x18,0x88,0x18,
  0x88,0x18,0x88,0x18,0x89,0x17,0x89,0x17,
  0x8A,0x16,0x8B,0x15,0x8C,0x0D,0x13,0x14,
  0x8E,0x0F,0x10,0x11,0x12,0xFF
]);

export const podSprite = new Uint8Array([
  0x80,0x80,0x80,0x80,0x8F,0x10,0x11,0x8D,
  0x0E,0x12,0x13,0x8C,0x14,0x8C,0x14,0x8B,
  0x15,0x8B,0x15,0x8B,0x15,0x8C,0x14,0x8C,
  0x14,0x8D,0x0E,0x12,0x13,0x8F,0x10,0x11,
  0xFF
]);
```

### 3.2 Angle-to-Vector Lookup Tables

These are Q2.8 signed fixed-point values used for thrust direction and pod attachment. Export as signed numbers (convert the original unsigned bytes: values ≥ 0x80 are negative, i.e. `value - 256`).

```typescript
// 32 entries, one per angle step (0-31)
// Index 0 = pointing up, 8 = pointing right, 16 = pointing down, 24 = pointing left
// Y values: negative = up thrust, positive = down
export const angleToY: readonly number[] = [
  // FRAC, INT pairs from the original tables, combined as: INT + FRAC/256
  // Raw FRAC: 0x80,0x8D,0xB1,0xEC,0x3C,0x9D,0x0C,0x84,0x00,0x7C,0xF4,0x63,0xC4,0x14,0x4F,0x73,
  //           0x80,0x73,0x4F,0x14,0xC4,0x63,0xF4,0x7C,0x00,0x84,0x0C,0x9D,0x3C,0xEC,0xB1,0x8D
  // Raw INT:  0xFD,0xFD,0xFD,0xFD,0xFE,0xFE,0xFF,0xFF,0x00,0x00,0x00,0x01,0x01,0x02,0x02,0x02,
  //           0x02,0x02,0x02,0x02,0x01,0x01,0x00,0x00,0x00,0xFF,0xFF,0xFE,0xFE,0xFD,0xFD,0xFD
  -2.5,  -2.45, -2.31, -2.08, -1.76, -1.39, -0.95, -0.48,
   0.0,   0.48,  0.95,  1.39,  1.76,  2.08,  2.31,  2.45,
   2.5,   2.45,  2.31,  2.08,  1.76,  1.39,  0.95,  0.48,
   0.0,  -0.48, -0.95, -1.39, -1.76, -2.08, -2.31, -2.45,
];

// X values: positive = right thrust, negative = left
export const angleToX: readonly number[] = [
   0.0,   0.24,  0.48,  0.69,  0.88,  1.04,  1.15,  1.22,
   1.25,  1.22,  1.15,  1.04,  0.88,  0.69,  0.48,  0.24,
   0.0,  -0.24, -0.48, -0.69, -0.88, -1.04, -1.15, -1.22,
  -1.25, -1.22, -1.15, -1.04, -0.88, -0.69, -0.48, -0.24,
];
```

> **Note**: The approximate float values above are derived from the Q2.8 fixed-point originals. For pixel-perfect fidelity, you could use the raw INT+FRAC bytes and do the fixed-point arithmetic, but floats are fine for a Canvas renderer.

---

## 4. Sprite Decoder (`ShipSpriteDecoder.ts`)

### 4.1 BBC Micro MODE 1 Sprite Encoding

This is the most critical section. The original sprites are encoded in a custom column-based run-length format designed for the BBC Micro's MODE 1 screen layout.

**BBC Micro MODE 1 screen layout:**
- 320×256 pixels, 4 colours
- Screen is arranged in character cells: 8 bytes per cell (one byte per pixel row)
- Each byte contains 4 pixels (2 bits per pixel, interleaved)
- Character cells are 1 byte wide × 8 pixels tall
- A character row is 40 cells wide = 320 pixels, stored as 40 × 8 = 320 bytes per character row

**Pixel encoding in a byte (MODE 1):**
```
Bit 7  Bit 6  Bit 5  Bit 4  Bit 3  Bit 2  Bit 1  Bit 0
Px0-H  Px1-H  Px2-H  Px3-H  Px0-L  Px1-L  Px2-L  Px3-L
```
Pixel masks for 4 pixel positions within a byte:
- `pixel_masks_1 = [0x88, 0x44, 0x22, 0x11]` — both bits set (colour 3)
- `pixel_masks_2 = [0x80, 0x40, 0x20, 0x10]` — high bit only (colour 2)
- `pixel_masks_3 = [0x08, 0x04, 0x02, 0x01]` — low bit only (colour 1)

### 4.2 Sprite Data Format

Each sprite is a stream of bytes processed sequentially. Bytes fall into three categories:

| Byte Value | Meaning |
|---|---|
| `0xFF` | **End of sprite** — stop processing |
| `0x80` | **Empty column** — advance to the next column with no pixels |
| `0x81`–`0x9F` | **Skip rows marker** — the value `(byte AND 0x1F)` gives the starting row offset for the next run of pixel data within the current column. This effectively creates vertical gaps. |
| `0x00`–`0x7F` | **Pixel data** — plot a pixel at the position encoded in this byte |

### 4.3 Decoding a Pixel Byte

When a pixel data byte (0x00–0x7F) is encountered, it encodes both a **sub-pixel X offset** and a **Y offset within the current column**. The original code does this:

```
// Original 6502 logic for a pixel byte:
value = spriteByte              // 0x00-0x7F
value = value EOR 0x1F          // flip bits (for normal sprites)
value = value + 1 + subPixelOffset  // SEC then ADC plot_ship_L0075

yOffset = (value AND 0x3C) << 1    // character cell row offset * 2 (gives byte offset within cell)
pixelIndex = value AND 0x03         // which of the 4 pixel positions in the byte
```

However, in the **mirrored** case (angles 17–31), the EOR and ADC are replaced with `CMP #$FF` which sets carry but doesn't modify the value, so the pixel byte is used more directly with just `ADC subPixelOffset`.

**Simplified decoding for our Canvas renderer:**

For each pixel byte, we need to extract a **(column, row)** position relative to the sprite's top-left corner:

```typescript
function decodeSprite(data: Uint8Array, mirrored: boolean): DecodedSprite {
  const pixels: Array<{ x: number; y: number }> = [];
  let column = 0;        // current column (character cell x)
  let byteInColumn = 0;  // tracks position within the 8-byte character cell
  let i = 0;

  while (i < data.length) {
    const b = data[i++];

    if (b === 0xFF) break;              // end of sprite

    if (b === 0x80) {
      // empty column — move to next
      column++;
      byteInColumn = 0;
      continue;
    }

    if (b >= 0x81 && b <= 0x9F) {
      // row skip marker within current column
      // The low 5 bits encode the starting position
      // This positions us within the character cell grid
      byteInColumn = b & 0x1F;
      // Process subsequent pixel bytes in this column
      continue;
    }

    // Pixel data byte (0x00–0x7F)
    // The byte encodes a position within a ~4-column, multi-row grid
    // relative to the current drawing position
    //
    // For a simpler Canvas approach, we process pixel values as:
    //   adjusted = (value EOR 0x1F) + 1 + subPixelOffset  (normal)
    //   adjusted = value + subPixelOffset                  (mirrored)
    //
    // Then: yOffset = (adjusted & 0x3C) >> 2  (row within character cell area)
    //       xSub    = adjusted & 0x03          (sub-column pixel position)

    // For the Canvas renderer, decode without the sub-pixel system.
    // Each pixel byte maps to an (x, y) in a coordinate space where:
    //   x = column * 4 + pixelPosition
    //   y = row derived from the value

    // See Section 4.4 for the complete decode algorithm
  }

  return { pixels, width: maxX + 1, height: maxY + 1 };
}
```

### 4.4 Complete Decode Algorithm

The original rendering is tightly coupled to the BBC Micro screen memory layout. For a Canvas renderer, we need to separate the pixel position computation from the hardware-specific addressing.

Here is the full decode algorithm. The key insight is that each sprite byte stream describes columns left-to-right, where each column is one **character cell wide** (4 MODE 1 pixels). Within each column, pixel bytes encode a local (x, y) offset using a combined value that packs both row and sub-pixel position.

```typescript
interface SpritePixel {
  x: number;  // pixel x coordinate (in MODE 1 pixels, where each is 2px wide on screen)
  y: number;  // pixel y coordinate
}

/**
 * Decode a Thrust sprite byte array into pixel positions.
 *
 * @param data - Raw sprite byte array (terminated by 0xFF)
 * @param subPixelOffset - The `plot_ship_L0075` value (0-3), derived from
 *   the fractional part of the ship's x position. Controls sub-character-cell
 *   horizontal alignment. Use 0 for static rendering.
 * @param mirrored - If true, uses the mirrored decode path (angles 17-31).
 *   In the original, mirroring is achieved by changing the EOR/ADC operation
 *   and using pixel_masks_1 instead of pixel_masks_3.
 */
function decodeSpriteBytes(
  data: Uint8Array,
  subPixelOffset: number = 0,
  mirrored: boolean = false
): SpritePixel[] {
  const pixels: SpritePixel[] = [];
  let columnCharX = 0;  // which character cell column we're in
  let cellByteCounter = 7; // counts down within a character cell (0-7), starts at 7
                            // When it goes negative, we've crossed a cell row boundary
  let i = 0;

  while (i < data.length) {
    const b = data[i];

    if (b === 0xFF) break; // end marker

    if (b >= 0x80) {
      // High bit set: control byte
      if (b === 0x80) {
        // Empty column — skip to next character column
        // Treated as a column with no pixels; advances column
        // (Multiple 0x80s in sequence = multiple empty columns)
        i++;
        // Actually 0x80 is processed by the main loop the same as other >=0x80 bytes
        // but it also marks column boundaries when encountered at the start
        // Let's handle it properly:
      }

      // Values 0x80-0x9F (and 0x80 specifically):
      // When encountered, the sprite renderer checks if cellByteCounter has
      // gone negative (crossed a character cell boundary). If not, it increments
      // the screen pointer (moving right one character cell). If yes, it jumps
      // to the next character row.
      //
      // The value (b & 0x1F) gives the number of empty pixel rows to skip
      // before the next pixel data in this column group.

      // For Canvas decoding purposes:
      // A byte >= 0x80 signals a new row group. The (b & 0x1F) encodes
      // vertical skip information.

      // SIMPLIFIED APPROACH (see section 4.5):
      // Count 0x80 bytes to determine column, and use (0x81-0x9F & 0x1F) as row skip.
      i++;
      continue;
    }

    // Pixel data byte (0x00-0x7F)
    // Decode position:
    let adjusted: number;
    if (!mirrored) {
      // Normal: EOR #$1F, SEC, ADC subPixelOffset
      // SEC sets carry=1, so effectively: (b ^ 0x1F) + 1 + subPixelOffset
      adjusted = (b ^ 0x1F) + 1 + subPixelOffset;
    } else {
      // Mirrored: CMP #$FF (sets carry but doesn't change A), ADC subPixelOffset
      // CMP #$FF with any value 0x00-0x7F will always set carry
      // So: b + 1 + subPixelOffset
      adjusted = b + 1 + subPixelOffset;
    }

    const rowOffset = (adjusted & 0x3C) >> 2;    // rows 0-15 within current area
    const pixelInByte = adjusted & 0x03;          // pixel position 0-3 within character cell byte

    const x = columnCharX * 4 + pixelInByte;
    const y = rowOffset; // need to add the base Y from column tracking

    pixels.push({ x, y });
    i++;
  }

  return pixels;
}
```

### 4.5 Recommended Simplified Approach

The original code's tight coupling to BBC Micro hardware makes a literal port unnecessarily complex. Instead, **pre-render each sprite to a bitmap at build time** using the following strategy:

1. **Write a reference decoder** that processes the byte stream to produce a pixel grid
2. **Validate visually** against screenshots of the original game
3. **Cache the result** as `boolean[][]` grids (or `ImageData`)

The fastest path to visual correctness:

```typescript
/**
 * High-level approach: decode each sprite into a pixel grid by simulating
 * the BBC Micro screen memory writes, then read back the pixel positions.
 *
 * Allocate a virtual screen buffer (a small one, say 32x32 character cells
 * = 128x256 pixels), run the original plot algorithm against it, then
 * extract which pixels were set.
 */
export function decodeAllSprites(): Map<number, DecodedSprite> {
  const result = new Map<number, DecodedSprite>();

  for (let angle = 0; angle <= 16; angle++) {
    result.set(angle, decodeSpriteToGrid(shipSprites[angle], false));
  }

  // Angles 17-31 are mirrored versions of sprites 15 down to 1
  // angle 17 uses sprite (32 - 17) = 15, mirrored
  // angle 18 uses sprite (32 - 18) = 14, mirrored
  // ...
  // angle 31 uses sprite (32 - 31) = 1, mirrored
  for (let angle = 17; angle <= 31; angle++) {
    const sourceSprite = 32 - angle;  // maps 17->15, 18->14, ..., 31->1
    result.set(angle, decodeSpriteToGrid(shipSprites[sourceSprite], true));
  }

  // Also decode shield and pod
  result.set(SHIELD_SPRITE_ID, decodeSpriteToGrid(shieldSprite, false));
  result.set(POD_SPRITE_ID, decodeSpriteToGrid(podSprite, false));

  return result;
}
```

The mirroring logic from the original code at `plot_ship_or_sheild`:
- **Angles 0–16** (`sprite_number < 0x11`): use sprites 0–16 directly with `EOR #$1F` + `pixel_masks_3`
- **Angles 17–31** (`sprite_number >= 0x11`): calculate `spriteIndex = (sprite_number EOR 0x1F) + 1`, giving 16→0, i.e. sprite 15 for angle 17, sprite 14 for angle 18, etc. Uses `EOR #$1F` operation for pixel bytes + `pixel_masks_1`. The mirroring happens because the EOR/pixel-mask combination causes the sub-pixel positions to be read in reverse order within each byte.

### 4.6 Virtual Screen Buffer Approach (Most Accurate)

For maximum fidelity, simulate a small BBC Micro MODE 1 framebuffer and run the sprite plotter against it:

```typescript
class BBCMicroFramebuffer {
  // MODE 1: each byte holds 4 pixels (2 bits each, interleaved)
  // Screen is arranged as character cells: 8 bytes vertically per cell
  // Character row = 40 cells × 8 bytes = 320 bytes
  private buffer: Uint8Array;
  private widthChars: number;  // width in character cells
  private heightChars: number;

  constructor(widthChars: number = 20, heightChars: number = 20) {
    this.widthChars = widthChars;
    this.heightChars = heightChars;
    this.buffer = new Uint8Array(widthChars * heightChars * 8);
  }

  /** Get the byte offset for a given character cell position + row within cell */
  getOffset(charX: number, charY: number, rowInCell: number): number {
    return (charY * this.widthChars * 8) + (charX * 8) + rowInCell;
  }

  /** XOR a pixel mask into the buffer (exactly what the original does) */
  xorByte(offset: number, mask: number): void {
    this.buffer[offset] ^= mask;
  }

  /** Read back all set pixels as (x,y) coordinates */
  extractPixels(): SpritePixel[] {
    const pixels: SpritePixel[] = [];
    for (let charY = 0; charY < this.heightChars; charY++) {
      for (let charX = 0; charX < this.widthChars; charX++) {
        for (let row = 0; row < 8; row++) {
          const offset = this.getOffset(charX, charY, row);
          const b = this.buffer[offset];
          if (b === 0) continue;
          // Check each of 4 pixel positions
          for (let px = 0; px < 4; px++) {
            if (b & [0x88, 0x44, 0x22, 0x11][px]) {
              pixels.push({
                x: charX * 4 + px,
                y: charY * 8 + row
              });
            }
          }
        }
      }
    }
    return pixels;
  }
}
```

Then run the sprite plotter against this buffer, following the exact logic from `plot_ship_start` through `plot_ship_return`.

---

## 5. Ship Renderer (`ShipRenderer.ts`)

### 5.1 Rendering to Canvas

```typescript
export class ShipRenderer {
  private sprites: Map<number, DecodedSprite>;
  private scale: number;
  private colour: string;

  constructor(scale: number = 4, colour: string = '#FFFFFF') {
    this.scale = scale;
    this.colour = colour;
    this.sprites = decodeAllSprites();
  }

  /**
   * Draw the ship at the given position and angle.
   *
   * MODE 1 pixels are 2:1 aspect ratio (each logical pixel is 2 physical
   * pixels wide). The scale factor is applied on top of this.
   */
  render(ctx: CanvasRenderingContext2D, state: ShipState): void {
    const spriteId = state.shieldActive ? SHIELD_SPRITE_ID : (state.angle & 0x1F);
    const sprite = this.sprites.get(spriteId);
    if (!sprite) return;

    const pixelW = this.scale * 2;  // MODE 1 pixels are double-wide
    const pixelH = this.scale;

    // Centre the sprite on the ship position
    const offsetX = state.x - (sprite.width * pixelW) / 2;
    const offsetY = state.y - (sprite.height * pixelH) / 2;

    ctx.fillStyle = this.colour;
    for (const pixel of sprite.pixels) {
      ctx.fillRect(
        offsetX + pixel.x * pixelW,
        offsetY + pixel.y * pixelH,
        pixelW,
        pixelH
      );
    }
  }

  /** Render all 32 angles as a sprite sheet (for debugging) */
  renderSpriteSheet(ctx: CanvasRenderingContext2D): void {
    const cellSize = 80;
    for (let angle = 0; angle < 32; angle++) {
      const col = angle % 8;
      const row = Math.floor(angle / 8);
      const x = col * cellSize + cellSize / 2;
      const y = row * cellSize + cellSize / 2;

      this.render(ctx, { x, y, angle, shieldActive: false });

      // Label
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.fillText(`${angle}`, col * cellSize + 2, row * cellSize + 12);
    }
  }
}
```

### 5.2 Colour Palette

The original game uses BBC Micro MODE 1 with a modified palette. The default MODE 1 palette is:

| Logical Colour | Default | Thrust Usage |
|---|---|---|
| 0 (background) | Black `#000000` | Black `#000000` |
| 1 | Red `#FF0000` | Varies by level (terrain) |
| 2 | Yellow `#FFFF00` | Varies by level |
| 3 | White `#FFFFFF` | White `#FFFFFF` (ship) |

The ship is rendered in **colour 3** (white) for normal sprites, or **colour 1** for the shield. The pixel_masks tables select which colour bits are set:
- `pixel_masks_3 = [0x08, 0x04, 0x02, 0x01]` → sets low bit only → colour 1
- `pixel_masks_1 = [0x88, 0x44, 0x22, 0x11]` → sets both bits → colour 3

Wait — re-reading the code: normal ship sprites use `pixel_masks_3` (colour 1), the shield uses `pixel_masks_1` (colour 3). This may seem counterintuitive but the XOR-based plotting means the masks determine which colour bits are toggled. For a Canvas renderer, just pick appropriate colours:

- **Ship**: White or green (depending on your palette choice)
- **Shield**: Brighter/different colour to distinguish from ship

---

## 6. Rotation System

### 6.1 Angle Model

- 32 discrete angles (0–31), wrapping with `AND 0x1F`
- Angle 0 = **pointing straight up** (nose up)
- Angle 8 = pointing right
- Angle 16 ($10) = pointing straight down
- Angle 24 = pointing left
- Angular step = 360° / 32 = **11.25° per step**
- Rotation is rate-limited: only applied when `(tickCounter & 0x03) != 0`, meaning rotation happens 3 out of every 4 ticks

### 6.2 Sprite-to-Angle Mapping

| Angle | Sprite Used | Mirror? | Visual Direction |
|---|---|---|---|
| 0 | sprite 0 | No | Up |
| 1 | sprite 1 | No | Slightly right of up |
| ... | ... | No | ... |
| 8 | sprite 8 | No | Right |
| ... | ... | No | ... |
| 16 | sprite 16 | No | Down |
| 17 | sprite 15 | **Yes** | Slightly left of down |
| 18 | sprite 14 | **Yes** | ... |
| ... | ... | **Yes** | ... |
| 24 | sprite 8 | **Yes** | Left (mirrored right) |
| ... | ... | **Yes** | ... |
| 31 | sprite 1 | **Yes** | Slightly left of up |

Sprite selection formula:
- Angles 0–16: `spriteIndex = angle`, `mirrored = false`
- Angles 17–31: `spriteIndex = 32 - angle`, `mirrored = true`

---

## 7. Demo Harness (`index.ts`)

Create an interactive demo:

- Black background canvas (simulate the BBC Micro look)
- Ship centred on screen
- **Left/Right arrow keys** rotate the ship (decrement/increment angle, AND 0x1F)
- **Space** toggles shield on/off
- Display current angle number
- Optional: render all 32 angles as a sprite sheet below the main view
- Optional: show the thrust vector direction as a line from the ship centre using the `angleToX` / `angleToY` tables

### 7.1 Keyboard Mapping (Original → Modern)

| Original Key | Function | Demo Key |
|---|---|---|
| Caps Lock | Rotate left (anticlockwise) | Left Arrow |
| Ctrl | Rotate right (clockwise) | Right Arrow |
| Space | Shield/Tractor beam | Space |
| Return / Shift | Thrust | Up Arrow |

---

## 8. Implementation Notes

### 8.1 Aspect Ratio
BBC Micro MODE 1 has 320×256 pixels on a 4:3 display. Each pixel is wider than it is tall (approximately 2:1 ratio). When rendering to Canvas, each sprite pixel should be drawn as a rectangle that is **twice as wide as it is tall** to match the original look.

### 8.2 XOR Plotting
The original uses XOR to plot sprites (this allows erasing by plotting again). For the Canvas renderer you don't need XOR — just clear and redraw each frame. However, if you want to implement collision detection the original way, XOR plotting against a background buffer detects collisions when the AND test after XOR finds non-zero bits (meaning a sprite pixel overlapped an existing pixel).

### 8.3 Sub-Pixel Offset (`plot_ship_L0075`)
The `plot_ship_L0075` value (0–3) is derived from the fractional bits of the ship's x-position. It shifts the sprite's pixel positions horizontally by 0–3 sub-pixels within a character cell, providing smooth scrolling at sub-character resolution. For a static demo, use 0. For smooth movement, derive it from `Math.floor((shipX * 4) % 4)` or similar.

### 8.4 Performance
With 32 pre-decoded sprites cached as pixel lists, rendering is a simple loop of `fillRect` calls — easily fast enough for 60fps. For higher performance, pre-render each sprite to an offscreen `ImageData` or `OffscreenCanvas` and use `drawImage`.

---

## 9. Acceptance Criteria

1. All 32 rotation angles render correctly with visible asymmetry between left-leaning and right-leaning orientations (the mirrored sprites should be horizontally flipped versions of their source sprites)
2. Sprite 0 (angle 0) looks like an upward-pointing ship nose
3. Sprite 8 (angle 8) looks like a rightward-pointing ship
4. Sprite 16 (angle 16) looks like a downward-pointing ship
5. Angle 24 should be the horizontal mirror of angle 8 (leftward)
6. Shield sprite renders as a circle around the ship area
7. Pod sprite renders as a small circular object
8. MODE 1 pixel aspect ratio (2:1 width:height) is respected
9. Rotation wraps smoothly from angle 31 → 0 and 0 → 31
10. Keyboard rotation at appropriate speed (3 out of 4 frames, matching original rate limiting)
