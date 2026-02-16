const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ============================================================================
// BBC Micro MODE 1 Framebuffer Simulator
// ============================================================================
// MODE 1: 320x256, 4 colours, 2 bits per pixel (interleaved in each byte)
// Screen arranged in character cells: 8 bytes per cell (one per pixel row)
// Each byte = 4 pixels. Bit layout:
//   Bit 7  6  5  4  3  2  1  0
//   Px0H Px1H Px2H Px3H Px0L Px1L Px2L Px3L

class BBCFramebuffer {
  constructor(widthChars, heightChars) {
    this.widthChars = widthChars;
    this.heightChars = heightChars;
    // Each character cell = 8 bytes. Row of cells = widthChars * 8 bytes.
    this.rowBytes = widthChars * 8;
    this.buffer = new Uint8Array(widthChars * heightChars * 8);
  }

  clear() {
    this.buffer.fill(0);
  }

  // Get buffer offset from character cell position + row within cell
  offset(charX, charRow, rowInCell) {
    return charRow * this.rowBytes + charX * 8 + rowInCell;
  }

  // XOR a byte into the buffer at a given offset (exactly what the BBC does)
  xor(offset, value) {
    if (offset >= 0 && offset < this.buffer.length) {
      this.buffer[offset] ^= value;
    }
  }

  // Read a byte
  read(offset) {
    if (offset >= 0 && offset < this.buffer.length) {
      return this.buffer[offset];
    }
    return 0;
  }

  // Extract all pixels as {x, y, colour} array
  extractPixels() {
    const pixels = [];
    for (let charRow = 0; charRow < this.heightChars; charRow++) {
      for (let charX = 0; charX < this.widthChars; charX++) {
        for (let row = 0; row < 8; row++) {
          const off = this.offset(charX, charRow, row);
          const b = this.buffer[off];
          if (b === 0) continue;
          for (let px = 0; px < 4; px++) {
            const highBit = (b >> (7 - px)) & 1;
            const lowBit = (b >> (3 - px)) & 1;
            const colour = (highBit << 1) | lowBit;
            if (colour !== 0) {
              pixels.push({
                x: charX * 4 + px,
                y: charRow * 8 + row,
                colour
              });
            }
          }
        }
      }
    }
    return pixels;
  }
}

// ============================================================================
// Pixel masks from the disassembly
// ============================================================================
const pixel_masks_1 = [0x88, 0x44, 0x22, 0x11]; // colour 3 (both bits)
const pixel_masks_2 = [0x80, 0x40, 0x20, 0x10]; // colour 2 (high bit)
const pixel_masks_3 = [0x08, 0x04, 0x02, 0x01]; // colour 1 (low bit)

// ============================================================================
// Ship sprite data (verbatim from disassembly)
// ============================================================================
const shipSprites = [
  [0x10,0x8F,0x11,0x8F,0x11,0x8E,0x12,0x8E,0x12,0x8D,0x13,0x8D,0x13,0x8C,0x14,0x8C,0x14,0x8A,0x0B,0x15,0x16,0x89,0x17,0x8A,0x16,0x8B,0x15,0x8B,0x0F,0x10,0x11,0x15,0x8C,0x0E,0x12,0x14,0x8D,0x13,0xFF],
  [0x12,0x91,0x13,0x90,0x13,0x8F,0x13,0x8F,0x13,0x8E,0x14,0x8D,0x14,0x8D,0x14,0x8A,0x0B,0x0C,0x14,0x89,0x14,0x8A,0x15,0x16,0x8A,0x17,0x8B,0x16,0x8B,0x0E,0x0F,0x10,0x15,0x8C,0x0D,0x11,0x14,0x92,0x13,0xFF],
  [0x93,0x14,0x92,0x14,0x91,0x14,0x8F,0x10,0x14,0x8E,0x14,0x8D,0x14,0x8A,0x0B,0x0C,0x14,0x89,0x14,0x89,0x14,0x8A,0x14,0x8A,0x15,0x8B,0x16,0x8B,0x0D,0x0E,0x0F,0x15,0x8C,0x10,0x13,0x14,0x90,0x12,0x91,0xFF],
  [0x80,0x95,0x16,0x93,0x14,0x16,0x91,0x12,0x16,0x90,0x16,0x8B,0x0C,0x0E,0x0F,0x16,0x8A,0x0D,0x15,0x8A,0x15,0x8A,0x15,0x8A,0x15,0x8A,0x14,0x8B,0x0C,0x0D,0x15,0x8E,0x16,0x8F,0x15,0x16,0x8F,0x12,0x13,0x14,0x90,0x11,0xFF],
  [0x80,0x80,0x95,0x16,0x17,0x92,0x13,0x14,0x17,0x8C,0x10,0x11,0x17,0x8B,0x0D,0x0F,0x16,0x8B,0x0E,0x16,0x8B,0x16,0x8A,0x15,0x8A,0x15,0x8A,0x14,0x8B,0x0C,0x13,0x8D,0x14,0x8E,0x15,0x8E,0x12,0x13,0x14,0x8F,0x10,0x11,0xFF],
  [0x80,0x80,0x80,0x8C,0x0D,0x14,0x15,0x16,0x17,0x18,0x8C,0x0E,0x10,0x11,0x12,0x13,0x18,0x8B,0x0F,0x17,0x8B,0x17,0x8B,0x16,0x8A,0x16,0x8A,0x15,0x8B,0x0C,0x14,0x8D,0x14,0x8E,0x13,0x8E,0x14,0x8E,0x14,0x8F,0x10,0x11,0x12,0x13,0xFF],
  [0x80,0x80,0x80,0x8E,0x8D,0x0F,0x8C,0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x8C,0x19,0x8B,0x18,0x8A,0x17,0x8B,0x0C,0x16,0x8D,0x16,0x8D,0x15,0x8D,0x14,0x8C,0x13,0x8D,0x0E,0x13,0x8F,0x10,0x13,0x91,0x12,0xFF],
  [0x80,0x80,0x8F,0x8E,0x10,0x8D,0x10,0x8C,0x11,0x12,0x13,0x14,0x15,0x8B,0x16,0x17,0x18,0x19,0x8B,0x1A,0x8C,0x19,0x8D,0x18,0x8D,0x16,0x17,0x8D,0x15,0x8C,0x13,0x14,0x8C,0x12,0x8D,0x0E,0x12,0x8F,0x10,0x12,0x91,0xFF],
  [0x80,0x80,0x90,0x8F,0x11,0x8D,0x0E,0x11,0x8C,0x12,0x13,0x8B,0x14,0x15,0x8C,0x16,0x17,0x8D,0x18,0x19,0x8D,0x1A,0x8D,0x18,0x19,0x8C,0x16,0x17,0x8B,0x14,0x15,0x8C,0x12,0x13,0x8D,0x0E,0x11,0x8F,0x11,0x90,0xFF],
  [0x80,0x80,0x91,0x8F,0x10,0x12,0x8D,0x0E,0x12,0x8C,0x12,0x8C,0x13,0x14,0x8D,0x15,0x8D,0x16,0x17,0x8D,0x18,0x8C,0x19,0x8B,0x1A,0x8B,0x16,0x17,0x18,0x19,0x8C,0x11,0x12,0x13,0x14,0x15,0x8D,0x10,0x8E,0x10,0x8F,0xFF],
  [0x80,0x80,0x91,0x12,0x8F,0x10,0x13,0x8D,0x0E,0x13,0x8C,0x13,0x8D,0x14,0x8D,0x15,0x8D,0x16,0x8B,0x0C,0x16,0x8A,0x17,0x8B,0x18,0x8C,0x19,0x8C,0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x8D,0x0F,0x8E,0xFF],
  [0x80,0x80,0x80,0x8F,0x10,0x11,0x12,0x13,0x8E,0x14,0x8E,0x14,0x8E,0x13,0x8D,0x14,0x8B,0x0C,0x14,0x8A,0x15,0x8A,0x16,0x8B,0x16,0x8B,0x17,0x8B,0x0F,0x17,0x8C,0x0E,0x10,0x11,0x12,0x13,0x18,0x8C,0x0D,0x14,0x15,0x16,0x17,0x18,0xFF],
  [0x80,0x80,0x80,0x8F,0x10,0x11,0x8E,0x12,0x13,0x14,0x8E,0x15,0x8D,0x14,0x8B,0x0C,0x13,0x8A,0x14,0x8A,0x15,0x8A,0x15,0x8B,0x16,0x8B,0x0E,0x16,0x8B,0x0D,0x0F,0x16,0x8C,0x10,0x11,0x17,0x92,0x13,0x14,0x17,0x95,0x16,0x17,0xFF],
  [0x80,0x80,0x80,0x90,0x11,0x8F,0x12,0x13,0x14,0x8F,0x15,0x16,0x8E,0x16,0x8B,0x0C,0x0D,0x15,0x8A,0x14,0x8A,0x15,0x8A,0x15,0x8A,0x15,0x8A,0x0D,0x15,0x8B,0x0C,0x0E,0x0F,0x16,0x90,0x16,0x91,0x12,0x16,0x93,0x14,0x16,0x95,0x16,0xFF],
  [0x80,0x80,0x80,0x91,0x90,0x12,0x8C,0x10,0x13,0x14,0x8B,0x0D,0x0E,0x0F,0x15,0x8B,0x16,0x8A,0x15,0x8A,0x14,0x89,0x14,0x89,0x14,0x8A,0x0B,0x0C,0x14,0x8D,0x14,0x8E,0x14,0x8F,0x10,0x14,0x91,0x14,0x92,0x14,0x93,0x14,0xFF],
  [0x80,0x80,0x80,0x80,0x92,0x13,0x8C,0x0D,0x11,0x14,0x8B,0x0E,0x0F,0x10,0x15,0x8B,0x16,0x8A,0x17,0x8A,0x15,0x16,0x89,0x14,0x8A,0x0B,0x0C,0x14,0x8D,0x14,0x8D,0x14,0x8E,0x14,0x8F,0x13,0x8F,0x13,0x90,0x13,0x91,0x13,0x92,0xFF],
  [0x80,0x80,0x80,0x80,0x8D,0x13,0x8C,0x0E,0x12,0x14,0x8B,0x0F,0x10,0x11,0x15,0x8B,0x15,0x8A,0x16,0x89,0x17,0x8A,0x0B,0x15,0x16,0x8C,0x14,0x8C,0x14,0x8D,0x13,0x8D,0x13,0x8E,0x12,0x8E,0x12,0x8F,0x11,0x8F,0x11,0x90,0xFF],
];

const shieldSprite = [0x80,0x8E,0x0F,0x10,0x11,0x12,0x8C,0x0D,0x13,0x14,0x8B,0x15,0x8A,0x16,0x89,0x17,0x89,0x17,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x89,0x17,0x89,0x17,0x8A,0x16,0x8B,0x15,0x8C,0x0D,0x13,0x14,0x8E,0x0F,0x10,0x11,0x12,0xFF];

const podSprite = [0x80,0x80,0x80,0x80,0x8F,0x10,0x11,0x8D,0x0E,0x12,0x13,0x8C,0x14,0x8C,0x14,0x8B,0x15,0x8B,0x15,0x8B,0x15,0x8C,0x14,0x8C,0x14,0x8D,0x0E,0x12,0x13,0x8F,0x10,0x11,0xFF];

// ============================================================================
// Object sprite data (verbatim from disassembly)
// ============================================================================
const objectSprites = [
  { name: 'gun_up_right',
    A: [0x88,0x10,0x18,0x80,0x08,0x10,0x18,0x80,0x10,0x18,0x80,0x10,0x18,0x20,0x80,0x08,0x18,0x20,0x90,0x18,0x20,0x90,0x18,0x20,0x98,0x20,0x98,0x20,0xA0,0xA0,0xA0,0xA0,0xA0,0xFF],
    B: [0x66,0x77,0x88,0x11,0x99,0x88,0x66,0x66,0x66,0x11,0x88,0x11,0x88,0x88,0xFF,0xFF,0x66,0x88,0xEE,0x11,0x88,0x11,0x88,0x66,0x66,0x11,0x11,0x11,0x99,0x99,0x55,0x55,0x33,0xFF] },
  { name: 'gun_down_right',
    A: [0x20,0xA0,0xA0,0xA0,0xA0,0x98,0x20,0x98,0x20,0x90,0x18,0x20,0x90,0x18,0x20,0x80,0x08,0x18,0x20,0x80,0x10,0x18,0x20,0x80,0x10,0x18,0x80,0x08,0x10,0x18,0x88,0x10,0x18,0xFF],
    B: [0x33,0x55,0x55,0x99,0x99,0x11,0x11,0x66,0x11,0x11,0x88,0x66,0xEE,0x11,0x88,0xFF,0xFF,0x66,0x88,0x88,0x11,0x88,0x88,0x66,0x66,0x11,0x11,0x99,0x88,0x66,0x66,0x77,0x88,0xFF] },
  { name: 'gun_up_left',
    A: [0x88,0x10,0x18,0x88,0x10,0x18,0x20,0x88,0x10,0x20,0x80,0x08,0x10,0x20,0x80,0x08,0x18,0x20,0x80,0x08,0x10,0x80,0x08,0x10,0x80,0x08,0x80,0x08,0x80,0x80,0x80,0x80,0x80,0xFF],
    B: [0x11,0xEE,0x66,0x66,0x11,0x99,0x88,0x88,0x66,0x66,0x11,0x11,0x88,0x11,0x11,0x66,0xFF,0xFF,0x11,0x88,0x77,0x66,0x11,0x88,0x88,0x66,0x88,0x88,0x99,0x99,0xAA,0xAA,0xCC,0xFF] },
  { name: 'gun_down_left',
    A: [0x00,0x80,0x80,0x80,0x80,0x80,0x08,0x80,0x08,0x80,0x08,0x10,0x80,0x08,0x10,0x80,0x08,0x18,0x20,0x80,0x08,0x10,0x20,0x88,0x10,0x20,0x88,0x10,0x18,0x20,0x88,0x10,0x18,0xFF],
    B: [0xCC,0xAA,0xAA,0x99,0x99,0x88,0x88,0x88,0x66,0x66,0x11,0x88,0x11,0x88,0x77,0x11,0x66,0xFF,0xFF,0x11,0x11,0x88,0x11,0x88,0x66,0x66,0x66,0x11,0x99,0x88,0x11,0xEE,0x66,0xFF] },
  { name: 'fuel',
    A: [0x00,0x08,0x10,0x18,0x80,0x18,0x80,0x18,0x80,0x08,0x10,0x18,0x80,0x08,0x10,0x18,0x80,0x08,0x10,0x18,0x80,0x08,0x10,0x18,0x80,0x08,0x10,0x18,0x80,0x18,0x80,0x18,0x80,0x08,0x10,0x18,0x88,0x10,0x80,0x08,0x10,0x18,0x80,0x18,0xFF],
    B: [0x01,0x0F,0x0F,0x08,0x06,0x06,0x08,0x01,0x38,0x50,0x60,0x81,0x28,0x50,0x40,0x81,0x38,0x50,0x60,0x81,0x28,0x50,0x40,0x81,0x28,0x70,0x60,0xC1,0x08,0x01,0x06,0x06,0x01,0x0F,0x0F,0x08,0x88,0x11,0x11,0x88,0x11,0x88,0x11,0x88,0xFF] },
  { name: 'pod_stand',
    A: [0x90,0x88,0x10,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x18,0x88,0x10,0x18,0x90,0x88,0x18,0x88,0x10,0x18,0x88,0x18,0x88,0x10,0x18,0x90,0x90,0x90,0x88,0x10,0xFF],
    B: [0xEE,0x33,0x11,0x88,0x44,0x44,0x44,0x44,0x88,0x22,0x88,0x22,0x88,0x22,0x44,0x44,0x44,0x44,0x33,0x11,0x88,0xEE,0x02,0x08,0x05,0x0F,0x04,0x04,0x04,0x03,0x01,0x08,0x0A,0x0A,0x0A,0x01,0x01,0xFF] },
  { name: 'generator',
    A: [0x08,0x10,0x18,0x88,0x18,0x20,0x80,0x08,0x18,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x08,0x10,0x18,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0x80,0x20,0xFF],
    B: [0x01,0x0F,0x08,0x06,0x06,0xEE,0x01,0x08,0x01,0xAA,0x02,0xAA,0x04,0xAA,0x04,0xAA,0x08,0xAB,0x08,0xAB,0x08,0xAB,0x08,0xAB,0x04,0xAA,0x04,0xAA,0x02,0xAA,0xFF,0xFF,0xFF,0xFF,0xBB,0x88,0x11,0xB8,0x11,0xB8,0x11,0xB8,0x11,0xFF] },
  { name: 'door_switch_right',
    A: [0x80,0x80,0x08,0x88,0x88,0x88,0x88,0x88,0x88,0x88,0x88,0x88,0x88,0x80,0x08,0x80,0xFF],
    B: [0x0E,0x01,0x08,0x04,0x02,0x02,0x01,0x01,0x01,0x01,0x02,0x02,0x04,0x01,0x08,0x0E] },
  { name: 'door_switch_left',
    A: [0x88,0x80,0x08,0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x08,0x88,0xFF],
    B: [0x07,0x01,0x08,0x02,0x04,0x04,0x08,0x08,0x08,0x08,0x04,0x04,0x02,0x01,0x08,0x07] },
];

// ============================================================================
// SHIP SPRITE DECODER
// Faithfully simulates the plot_ship_or_sheild / plot_ship_loop routines
// ============================================================================

function decodeShipSprite(data, subPixelOffset, mirrored) {
  // Allocate a framebuffer large enough
  const fb = new BBCFramebuffer(16, 8);

  // Starting screen address: place sprite in middle of buffer
  // Character cell (4, 1) gives us room around the edges
  const startCharX = 4;
  const startCharRow = 1;
  let ptr = startCharRow * fb.rowBytes + startCharX * 8;
  const startPtr = ptr;

  // plot_ship_L0070: counts down within character cell column, when negative -> next char row
  // Initialised as: (ptr AND 0x07) XOR 0x07
  let cellCounter = (ptr & 0x07) ^ 0x07; // = 7 when aligned

  // Select pixel masks based on mirrored flag
  const pixelMasks = mirrored ? pixel_masks_1 : pixel_masks_3;

  // The write operation: for normal sprites (< 0x11), opcode is CMP #$FF (sets carry, no change to A)
  // For mirrored sprites (>= 0x11), opcode is EOR #$1F
  // Wait - re-reading the code more carefully:
  //
  // plot_ship_or_sheild sets up:
  //   sprite_number < 0 (shield): pixel_masks_1, opcode CMP #$FF
  //   sprite_number 0-16: pixel_masks_3, opcode CMP #$FF  
  //   sprite_number >= 17: pixel_masks_1, opcode EOR #$1F, value mirrored
  //
  // Then in the inner loop:
  //   SEC
  //   <opcode> <value>   ; CMP #$FF or EOR #$1F
  //   ADC plot_ship_L0075
  //
  // CMP #$FF: for any value 0-0x7F, subtracts 0xFF, result doesn't go into A
  //   but carry is SET (since A >= 0 and 0-0xFF is negative? No...)
  //   Actually CMP sets carry if A >= operand. A is 0x00-0x7F, operand is 0xFF.
  //   So carry is CLEAR. Then ADC adds with carry=0.
  //   Result: A + 0 + subPixelOffset = A + subPixelOffset
  //
  // EOR #$1F: A = A ^ 0x1F, carry unchanged (still set from SEC)
  //   Then ADC: (A ^ 0x1F) + 1 + subPixelOffset
  //
  // So:
  //   Normal (0-16): adjusted = pixelByte + subPixelOffset (carry clear from CMP)
  //   Mirrored (17-31): adjusted = (pixelByte ^ 0x1F) + 1 + subPixelOffset (carry set from SEC)

  let i = 0;

  function processPixelByte(b) {
    let adjusted;
    if (!mirrored) {
      // CMP #$FF clears carry, then ADC subPixelOffset (carry=0)
      adjusted = b + subPixelOffset;
    } else {
      // SEC, EOR #$1F, ADC subPixelOffset (carry=1 from SEC)
      adjusted = (b ^ 0x1F) + 1 + subPixelOffset;
    }

    // yOffset = (adjusted AND 0x3C) ROL = (adjusted AND 0x3C) << 1
    const yOffset = (adjusted & 0x3C) << 1;
    // pixelIndex = adjusted AND 0x03
    const pixelIndex = adjusted & 0x03;

    const mask = pixelMasks[pixelIndex];
    const offset = ptr + yOffset;

    if (offset >= 0 && offset < fb.buffer.length) {
      fb.xor(offset, mask);
    }
  }

  // Main loop - simulates plot_ship_start
  while (i < data.length) {
    const b = data[i];

    if (b === 0xFF) break;

    if (b < 0x80) {
      // Pixel data byte
      processPixelByte(b);
      i++;
      continue;
    }

    // b >= 0x80: control byte
    // Check if this is 0x80 (empty column marker) or a row-skip value

    // In the original code, when BMI branches (byte >= 0x80):
    //   if byte == 0xFF: return
    //   else: advance column
    //     DEC plot_ship_L0070
    //     if L0070 >= 0: INC ptr (next char cell right), then read next byte
    //     if L0070 < 0: L0070=7, ptr += 0x239 (next char row), then read next byte
    //     In both cases, read next byte from sprite data at current index
    //     if next byte == 0x80: goto main_loop (skip this column position)
    //     else: process as pixel byte

    cellCounter--;
    if (cellCounter >= 0) {
      ptr++;  // next character cell to the right
    } else {
      cellCounter = 7;
      ptr = ptr + 0x39;  // add SCREEN_CHAR_ROW_BYTES(0x240) - 7 = 0x239
      // But we need to account for the DEC that didn't happen... 
      // Actually: ptr currently points at byte 7 of current cell (we used INC for previous cells)
      // The code does: ptr_lo + 0x39, ptr_hi + 0x02
      // That's 0x0239 = 569 = character row bytes (72*8=576) - 7
      // This moves to the start of the next character row
      // Let me use the actual constant from the code
      ptr = (ptr & ~0x07) + 0x239 + 0x08; // align to next row start
      // Hmm, let me think about this differently.
      // ptr has been incremented cellCounter times from startPtr's row.
      // When counter goes negative, we need to jump to the first char cell of the NEXT char row.
      // In our linear buffer: next char row = current row start + rowBytes
      // The original adds 0x239 to handle the BBC's weird addressing.
      // For our linear buffer, let's track charX and charRow explicitly.
    }

    // After advancing, read the next byte (still at index i, which is the control byte)
    // The original code reads the next byte from the SAME index in the sprite data
    // because the control byte itself isn't consumed as a separate entry - 
    // No wait, looking at the code again:
    //
    // plot_ship_loop:
    //   LDX plot_ship_index
    //   INX                    ; increment index
    //   STX plot_ship_index
    //   LDA sprite_data,X     ; read byte at new index
    //   BMI L1F1F             ; if >= 0x80, handle control
    //   <process pixel>
    //
    // L1F1F (control path):
    //   CMP #$FF / BEQ return
    //   LDX plot_ship_index   ; re-load current index (not incremented again)
    //   DEC L0070
    //   BMI next_char_row
    //   INC ptr               ; same row, next cell
    //   LDA sprite_data,X     ; read SAME index again
    //   CMP #$80 / BNE pixel  ; if not 0x80, it's a pixel
    //   JMP plot_ship_loop    ; if 0x80, skip (go back to main which will INX)
    //
    // So after a control byte, it reads sprite_data[same_index] again.
    // If that's 0x80, it loops back (which INX's past it).
    // If not 0x80, it processes it as a pixel.
    //
    // But wait - the first read was at index X (after INX). The control byte IS at index X.
    // Then it reads sprite_data[X] again - that's the same control byte!
    // So it reads the control byte value & 0x7F... no, it does CMP #$80 / BNE pixel
    // The control byte was >= 0x80. So byte == 0x80 means skip, byte > 0x80 means...
    // it would try to process 0x81-0xFE as pixel data? That doesn't make sense.
    //
    // Actually looking more carefully at the three read sites:
    // L1EF6 (addr_1): initial read, BMI -> control
    // L1F2B (addr_2): after INC ptr (same row advance), CMP #$80 / BNE pixel
    // L1F46 (addr_3): after next-row advance, CMP #$80 / BNE pixel
    //
    // All three read from the SAME self-modified address (same sprite data).
    // addr_2 and addr_3 read at the SAME X index as addr_1 found the control byte.
    //
    // So if control byte is 0x80: addr_2/3 reads 0x80, CMP #$80 is equal, falls through to JMP plot_ship_loop
    // If control byte is 0x81-0xFE: addr_2/3 reads same value, CMP #$80 is not equal, processes as pixel
    //
    // But these are >= 0x80! And plot_ship_inner_loop starts with SEC then the opcode...
    // For EOR #$1F: 0x81 ^ 0x1F = 0x9E, that would give huge offsets
    // For CMP #$FF: doesn't modify A, so A is still 0x81+
    //
    // Hmm wait. Let me re-read. After CMP #$80 / BNE, it jumps to plot_ship_inner_loop.
    // plot_ship_inner_loop does SEC then the self-modified opcode.
    // For normal sprites: CMP #$FF. A is the control byte (say 0x8F).
    // CMP #$FF: 0x8F >= 0xFF? No. Carry CLEAR.
    // ADC subPixelOffset: 0x8F + 0 + subPixelOffset
    // This gives adjusted = 0x8F + subPixelOffset (say 0x8F for offset 0)
    // yOffset = (0x8F & 0x3C) << 1 = (0x0C) << 1 = 0x18
    // pixelIndex = 0x8F & 0x03 = 0x03
    // So a control byte like 0x8F also plots a pixel!
    //
    // I think I had this wrong. The control byte IS ALSO pixel data.
    // The 0x80+ bytes with bit 7 set serve DUAL purpose:
    //   1. Signal column advance
    //   2. After advancing, the byte itself (at same index) is re-read and 
    //      plotted as a pixel (unless it's exactly 0x80, which means empty column)
    //
    // This is elegant - the high bit means "advance column first", 
    // then the full byte value encodes the pixel position.

    // So: if b == 0x80, it's a pure skip (no pixel). JMP back to main loop which will INX.
    if (b === 0x80) {
      i++;
      continue;
    }

    // Otherwise, b is 0x81-0xFE: advance was done, now process b as a pixel byte
    processPixelByte(b & 0xFF); // process the FULL byte value
    // But wait - for CMP #$FF path (normal): adjusted = b + subPixelOffset
    // b is 0x81-0x9F typically. adjusted = 0x81 + 0 = 0x81
    // yOffset = (0x81 & 0x3C) << 1 = 0x00 << 1 = 0x00
    // pixelIndex = 0x81 & 0x03 = 0x01
    // That plots at yOffset=0, pixel=1. Makes sense as a position encoding!

    i++; // consumed this byte
  }

  return fb;
}

// OK, the above approach of tracking ptr arithmetic is getting tangled because
// the BBC's screen addressing is non-trivial. Let me restart with a cleaner 
// simulation that directly tracks character column and row.

function decodeShipSpriteClean(data, subPixelOffset, mirrored) {
  const fb = new BBCFramebuffer(20, 10);

  // We'll track position as a linear pointer into our framebuffer,
  // exactly as the original code does, but adjusted for our buffer layout.
  // Our buffer: charRow * rowBytes + charX * 8 + rowInCell
  // rowBytes = widthChars * 8

  const startCharX = 6;
  const startCharRow = 2;

  // Initial pointer
  let ptr = startCharRow * fb.rowBytes + startCharX * 8;

  // Cell counter (L0070): initialised as (ptr & 0x07) ^ 0x07
  // Since we start aligned (ptr & 7 == 0), this is 7
  let cellCounter = 7;

  const pixelMasks = mirrored ? pixel_masks_1 : pixel_masks_3;

  function plotPixel(b) {
    let adjusted;
    if (!mirrored) {
      adjusted = b + subPixelOffset;
    } else {
      adjusted = (b ^ 0x1F) + 1 + subPixelOffset;
    }

    const yByteOffset = (adjusted & 0x3C) << 1;
    const pixelIndex = adjusted & 0x03;
    const mask = pixelMasks[pixelIndex];

    // yByteOffset is the offset into screen memory from the current ptr.
    // In BBC memory, consecutive bytes are rows within a char cell.
    // Offsets 0-7 are within current cell, 8-15 next cell, etc.
    // In our framebuffer, cells are also 8 consecutive bytes,
    // but cells are laid out charX*8, not in screen raster order.
    // 
    // However, the original code uses (plot_ship_at_ptr),Y with Y = yByteOffset.
    // plot_ship_at_ptr points to a character cell in screen memory.
    // Y indexes linearly from there.
    // In BBC MODE 1 screen memory:
    //   offset 0-7: same cell, rows 0-7
    //   offset 8-15: next cell right, rows 0-7
    //   etc.
    // 
    // In our linear buffer, consecutive cells ARE 8 bytes apart too!
    // So ptr + yByteOffset should work directly!

    const addr = ptr + yByteOffset;
    if (addr >= 0 && addr < fb.buffer.length) {
      fb.buffer[addr] ^= mask;
    }
  }

  function advanceColumn() {
    cellCounter--;
    if (cellCounter >= 0) {
      // Next character cell to the right (add 8 bytes in our buffer, 
      // but the original adds 1 because BBC cells are 1 byte apart horizontally... 
      // No! In BBC screen memory, adjacent character cells are 8 bytes apart.
      // The INC ptr in the original adds 1 to the LOW byte of the address.
      // But ptr points to a specific row within a cell.
      // After INC, it points to the next row? No...
      //
      // Let me re-examine. ptr starts at the plotAddr which is calculated
      // to point to a specific byte in screen memory: charRow * charRowBytes + charX * 8 + rowInCell.
      // INC ptr: ptr now points to rowInCell+1 within the same cell.
      // But that's the NEXT SCAN LINE, not the next column!
      //
      // Oh! I think I've been misunderstanding the traversal.
      // The sprite data is NOT column-major across character cells.
      // The ptr moves through bytes WITHIN a character cell first (rows 0-7),
      // and cellCounter counts how many bytes remain in the current cell.
      // When it runs out (8 bytes used), ptr jumps to the next character ROW.
      //
      // So the sprite is rendered ROW by ROW within the cell, then moves down.
      // And the sprite data itself traverses bytes within a single column of cells,
      // moving to the next row of cells when the column runs out.
      //
      // Let me re-read the plot_ship_or_sheild setup:
      //   cellCounter (L0070) = (ptr & 0x07) ^ 0x07
      //   If ptr is aligned to cell start (rowInCell=0), cellCounter=7
      //   If ptr is at rowInCell=3, cellCounter=4
      //
      // This counts how many MORE bytes we can advance within the current cell
      // before crossing the boundary.
      //
      // INC ptr means ptr goes to next byte = next scan line within same cell.
      // When cellCounter hits -1, we've exhausted this cell column and need
      // to move to the START of the next character row.
      //
      // ptr += 0x239: that's charRowBytes(0x240) - 7.
      // If we were at byte 7 of cell (the last row), adding 0x239 takes us to
      // byte 0 of the same column position one character row down.
      // But we were at byte 7 and we've been incrementing through the cell...
      // Actually: ptr started at some rowInCell. After 7 INCs (for cellCounter=7),
      // ptr is at rowInCell+7. Then adding 0x239 = ptr + 569.
      // 
      // Hmm, I think the traversal goes like this for aligned start (row 0):
      //   cellCounter=7
      //   Byte 0 is the starting row. 
      //   First control byte: INC ptr -> byte 1, cellCounter=6
      //   Next: INC ptr -> byte 2, cellCounter=5
      //   ...
      //   cellCounter=0: INC ptr -> byte 7, cellCounter=-1
      //   Now: L0070=7, ptr += 0x239 
      //     ptr was at charRow*rowBytes + charX*8 + 7
      //     ptr + 0x239 = charRow*rowBytes + charX*8 + 7 + 0x239
      //                 = charRow*rowBytes + charX*8 + 576
      //                 = (charRow+1)*rowBytes + charX*8
      //     Yes! That's the start of the same column, next character row.
      //     (Assuming rowBytes = 72*8 = 576 = 0x240)
      //
      // But wait, our buffer has rowBytes = 20*8 = 160, not 576.
      // So we can't just add 0x239. We need to do the equivalent.

      ptr += 1; // next byte within current char cell = next scan line down
    } else {
      cellCounter = 7;
      // Move to next character row, same character column.
      // Current ptr is at rowInCell=7 (or wherever we ended up).
      // We need to go to: start of same charX, next charRow.
      // In our buffer: that's currentCharRow * rowBytes + charX * 8
      // Easiest: compute current charRow and charX from ptr.
      const currentByte = ptr % 8;
      const cellStart = ptr - currentByte;
      const charX = Math.floor((cellStart % fb.rowBytes) / 8);
      const charRow = Math.floor(cellStart / fb.rowBytes);
      ptr = (charRow + 1) * fb.rowBytes + charX * 8;
    }
  }

  let i = 0;

  while (i < data.length) {
    const b = data[i];

    if (b === 0xFF) break;

    if (b >= 0x80) {
      // Control byte: advance column first
      advanceColumn();

      if (b === 0x80) {
        // Pure empty - no pixel to plot
        i++;
        continue;
      }

      // b is 0x81-0xFE: also encodes a pixel position
      plotPixel(b);
      i++;
      continue;
    }

    // b is 0x00-0x7F: pure pixel data
    plotPixel(b);
    i++;
  }

  return fb;
}

// ============================================================================
// OBJECT SPRITE DECODER
// Faithfully simulates plot_static_sprite
// ============================================================================

function decodeObjectSprite(streamA, streamB) {
  const fb = new BBCFramebuffer(20, 10);

  const startCharX = 2;
  const startCharRow = 1;
  let ptr = startCharRow * fb.rowBytes + startCharX * 8;

  // L0072 = (ptr & 0x07) ^ 0x07 + 1
  // For aligned start: (0 ^ 7) + 1 = 8
  let cellBytesRemaining = ((ptr & 0x07) ^ 0x07) + 1;

  let idxA = 0;
  let idxB = 0;

  // Entry: jump to read_A (which is L11DB in the code)
  // L11DB: LDY streamA[X] -> if positive, goto plot (L11D3)
  //        if == 0xFF, return
  //        if 0x80-0xFE, goto L11B3 (advance column)

  while (idxA < streamA.length) {
    const a = streamA[idxA];

    if (a === 0xFF) break; // actually checked as CPY #$FF after already checking BPL

    if (a >= 0x80) {
      // L11B3: advance column
      // INC plot_sprite_at_ptr (ptr += 1, but this means next scan line!)
      // Actually no - for objects, INC plot_sprite_at_ptr means next byte.
      // Y = A & 0x7F (TYA / AND #$7F / TAY)
      // DEC L0072 (cellBytesRemaining)
      // if cellBytesRemaining > 0: read streamB[X], XOR into screen at (ptr),Y
      // if cellBytesRemaining == 0: ptr += 0x239, reset counter to 8, then read/plot
      
      ptr += 1;
      const offset = a & 0x7F;
      cellBytesRemaining--;

      if (cellBytesRemaining <= 0) {
        // Crossed character cell boundary -> next char row
        // DEC ptr first (the code does DEC before adding 0x239+carry)
        ptr -= 1;
        // ptr + 0x39 + carry + (ptr_hi + 0x02)
        // The code: ADC #$39 to low byte, ADC #$02 to high byte
        // That's 0x0239 + carry. Since DEC cleared... 
        // Actually the code does:
        //   DEC plot_sprite_at_ptr    ; ptr_lo -= 1
        //   LDA ptr_lo
        //   ADC #$39                  ; carry is unclear here
        //   STA ptr_lo
        //   LDA ptr_hi
        //   ADC #$02
        //   STA ptr_hi
        // Carry from the ADC #$39... it's not clear if SEC was done.
        // But the standard pattern for adding 0x240 (char row bytes) to move down a row:
        // After DEC, ptr is back to where it was before the INC.
        // Then add 0x240 (576) to go to next char row. 
        // 0x240 = 0x0240 = low byte 0x40, high byte 0x02
        // But the code adds 0x39 to low and 0x02 to high = 0x0239 = 569 = 576-7
        // Plus carry from the DEC + ADC... 
        // 
        // OK let me just do what the comment in the disassembly says:
        // "$239 - character row bytes - 7"
        // So it adds 0x240 - 7 = 0x239 to move to the next character row
        // then subtracts 7 to... no, it IS character row bytes minus 7.
        // After being at byte N of a cell, going +0x239 reaches next row start-ish.
        //
        // For our buffer, just compute the position explicitly:
        const currentByte = ptr % 8;
        const cellStart = ptr - currentByte;
        const charX = Math.floor((cellStart % fb.rowBytes) / 8);
        const charRow = Math.floor(cellStart / fb.rowBytes);
        ptr = (charRow + 1) * fb.rowBytes + charX * 8;
        cellBytesRemaining = 8;
      }

      // Now plot: streamB[idxB] XOR'd at (ptr + offset)
      if (idxB < streamB.length) {
        const pixelByte = streamB[idxB];
        const addr = ptr + offset;
        if (addr >= 0 && addr < fb.buffer.length) {
          fb.buffer[addr] ^= pixelByte;
        }
      }
      idxA++;
      idxB++;
      continue;
    }

    // a < 0x80: screen offset within current cell area
    // Read streamB and XOR at (ptr + a)
    if (idxB < streamB.length) {
      const pixelByte = streamB[idxB];
      const addr = ptr + a;
      if (addr >= 0 && addr < fb.buffer.length) {
        fb.buffer[addr] ^= pixelByte;
      }
    }
    idxA++;
    idxB++;
  }

  return fb;
}

// ============================================================================
// IMAGE OUTPUT
// ============================================================================

const MODE1_PALETTE = {
  0: [0, 0, 0],       // black
  1: [255, 0, 0],     // red  
  2: [255, 255, 0],   // yellow
  3: [255, 255, 255], // white
};

async function framebufferToPng(fb, filename, palette, pixelScaleX = 1, pixelScaleY = 1) {
  const pixels = fb.extractPixels();

  // Find bounding box
  if (pixels.length === 0) {
    console.log(`  WARNING: No pixels found for ${filename}`);
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spriteW = maxX - minX + 1;
  const spriteH = maxY - minY + 1;
  const imgW = spriteW * pixelScaleX;
  const imgH = spriteH * pixelScaleY;

  const imgData = Buffer.alloc(imgW * imgH * 4);

  // Fill with black background
  for (let i = 0; i < imgW * imgH; i++) {
    imgData[i * 4 + 3] = 255; // alpha
  }

  for (const p of pixels) {
    const col = palette[p.colour] || [255, 0, 255];
    const sx = (p.x - minX) * pixelScaleX;
    const sy = (p.y - minY) * pixelScaleY;

    for (let dy = 0; dy < pixelScaleY; dy++) {
      for (let dx = 0; dx < pixelScaleX; dx++) {
        const idx = ((sy + dy) * imgW + (sx + dx)) * 4;
        imgData[idx] = col[0];
        imgData[idx + 1] = col[1];
        imgData[idx + 2] = col[2];
        imgData[idx + 3] = 255;
      }
    }
  }

  await sharp(imgData, { raw: { width: imgW, height: imgH, channels: 4 } })
    .png()
    .toFile(filename);

  console.log(`  ${filename}: ${spriteW}x${spriteH} MODE1 pixels -> ${imgW}x${imgH}px`);
}

async function framebufferToFixedPng(fb, filename, palette, cropX, cropY, cropW, cropH, pixelScaleX = 1, pixelScaleY = 1) {
  const pixels = fb.extractPixels();

  const imgW = cropW * pixelScaleX;
  const imgH = cropH * pixelScaleY;
  const imgData = Buffer.alloc(imgW * imgH * 4);

  // Fill with black background
  for (let i = 0; i < imgW * imgH; i++) {
    imgData[i * 4 + 3] = 255; // alpha
  }

  for (const p of pixels) {
    const lx = p.x - cropX;
    const ly = p.y - cropY;
    if (lx < 0 || lx >= cropW || ly < 0 || ly >= cropH) continue;

    const col = palette[p.colour] || [255, 0, 255];
    const sx = lx * pixelScaleX;
    const sy = ly * pixelScaleY;

    for (let dy = 0; dy < pixelScaleY; dy++) {
      for (let dx = 0; dx < pixelScaleX; dx++) {
        const idx = ((sy + dy) * imgW + (sx + dx)) * 4;
        imgData[idx] = col[0];
        imgData[idx + 1] = col[1];
        imgData[idx + 2] = col[2];
        imgData[idx + 3] = 255;
      }
    }
  }

  await sharp(imgData, { raw: { width: imgW, height: imgH, channels: 4 } })
    .png()
    .toFile(filename);

  console.log(`  ${filename}: ${cropW}x${cropH} fixed canvas -> ${imgW}x${imgH}px`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const shipPalette = { 0: [0, 0, 0], 1: [255, 255, 255], 2: [255, 255, 255], 3: [255, 255, 255] };

  // ---- Pass 1: decode all ship/shield sprites to find union bounding box ----
  const allShipFbs = [];
  for (let angle = 0; angle <= 16; angle++) {
    allShipFbs[angle] = decodeShipSpriteClean(shipSprites[angle], 0, false);
  }
  for (let angle = 17; angle <= 31; angle++) {
    const sourceIdx = 32 - angle;
    allShipFbs[angle] = decodeShipSpriteClean(shipSprites[sourceIdx], 0, true);
  }
  const shieldFb = decodeShipSpriteClean(shieldSprite, 0, false);
  const podFb = decodeShipSpriteClean(podSprite, 0, false);

  // ---- Shared plot origin: use shield circle centre as anchor ----
  // The sprite data has embedded centering (leading blank rows + per-row horizontal skips)
  // so all sprites share the same plot origin and the visual centre is stable.
  const shieldPixels = shieldFb.extractPixels();
  let sMinX = Infinity, sMinY = Infinity, sMaxX = 0, sMaxY = 0;
  for (const p of shieldPixels) {
    if (p.x < sMinX) sMinX = p.x;
    if (p.y < sMinY) sMinY = p.y;
    if (p.x > sMaxX) sMaxX = p.x;
    if (p.y > sMaxY) sMaxY = p.y;
  }
  const anchorX = Math.round((sMinX + sMaxX) / 2);
  const anchorY = Math.round((sMinY + sMaxY) / 2);
  console.log(`Shield bbox: x=${sMinX}..${sMaxX}, y=${sMinY}..${sMaxY}`);
  console.log(`Anchor (shield centre): (${anchorX}, ${anchorY})`);

  // Find max extent from anchor across all sprites and shield
  let maxLeft = 0, maxRight = 0, maxUp = 0, maxDown = 0;
  for (const fb of [...allShipFbs, shieldFb]) {
    for (const p of fb.extractPixels()) {
      maxLeft = Math.max(maxLeft, anchorX - p.x);
      maxRight = Math.max(maxRight, p.x - anchorX);
      maxUp = Math.max(maxUp, anchorY - p.y);
      maxDown = Math.max(maxDown, p.y - anchorY);
    }
  }
  const halfW = Math.max(maxLeft, maxRight);
  const halfH = Math.max(maxUp, maxDown);
  const cropW = halfW * 2 + 1;
  const cropH = halfH * 2 + 1;
  const minX = anchorX - halfW;
  const minY = anchorY - halfH;
  console.log(`Uniform canvas: ${cropW}x${cropH}, anchor at centre (${halfW}, ${halfH})`);

  // ---- Pass 2: output all sprites on the shared canvas ----
  console.log('Ship sprites (angles 0-31):');
  for (let angle = 0; angle <= 31; angle++) {
    await framebufferToFixedPng(
      allShipFbs[angle],
      path.join(outDir, `ship_${String(angle).padStart(2, '0')}.png`),
      shipPalette, minX, minY, cropW, cropH
    );
  }

  console.log('Shield sprite:');
  await framebufferToFixedPng(shieldFb, path.join(outDir, 'shield.png'), shipPalette, minX, minY, cropW, cropH);

  // Pod (auto-cropped, separate object)
  console.log('Pod sprite:');
  await framebufferToPng(podFb, path.join(outDir, 'pod.png'), shipPalette);

  // Object sprites (auto-cropped, they don't rotate)
  // All object sprites use the same source palette:
  //   colour 1 → red (remapped to yellow at runtime)
  //   colour 2 → yellow (remapped to landscape colour at runtime)
  //   colour 3 → white (remapped to object colour at runtime)
  const fuelPalette = {
    0: [0, 0, 0],       // black
    1: [255, 0, 0],     // red   → colour 1
    2: [255, 255, 0],   // yellow → colour 2
    3: [255, 255, 255], // white  → colour 3
  };

  console.log('\nObject sprites:');
  for (let i = 0; i < objectSprites.length; i++) {
    const obj = objectSprites[i];
    const fb = decodeObjectSprite(obj.A, obj.B);
    const palette = obj.name === 'fuel' ? fuelPalette : MODE1_PALETTE;
    await framebufferToPng(fb, path.join(outDir, `obj_${i}_${obj.name}.png`), palette);
  }

  // Generate a combined sprite sheet
  console.log('\nGenerating sprite sheet...');
  await generateSpriteSheet(outDir);
}

async function generateSpriteSheet(outDir) {
  const sheetW = 300;
  const sheetH = 250;
  const sheetData = Buffer.alloc(sheetW * sheetH * 4);

  // Dark background
  for (let i = 0; i < sheetW * sheetH; i++) {
    sheetData[i * 4] = 20;
    sheetData[i * 4 + 1] = 20;
    sheetData[i * 4 + 2] = 30;
    sheetData[i * 4 + 3] = 255;
  }

  const sheet = sharp(sheetData, { raw: { width: sheetW, height: sheetH, channels: 4 } });

  // Composite all generated PNGs onto the sheet
  const composites = [];

  // Ship sprites in a 8x4 grid
  for (let angle = 0; angle <= 31; angle++) {
    const col = angle % 8;
    const row = Math.floor(angle / 8);
    const file = path.join(outDir, `ship_${String(angle).padStart(2, '0')}.png`);
    if (fs.existsSync(file)) {
      composites.push({
        input: file,
        left: 4 + col * 36,
        top: 4 + row * 30,
      });
    }
  }

  // Shield and pod
  const specialSprites = ['shield.png', 'pod.png'];
  for (let i = 0; i < specialSprites.length; i++) {
    const file = path.join(outDir, specialSprites[i]);
    if (fs.existsSync(file)) {
      composites.push({
        input: file,
        left: 4 + i * 40,
        top: 130,
      });
    }
  }

  // Object sprites
  for (let i = 0; i < objectSprites.length; i++) {
    const file = path.join(outDir, `obj_${i}_${objectSprites[i].name}.png`);
    if (fs.existsSync(file)) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      composites.push({
        input: file,
        left: 4 + col * 56,
        top: 165 + row * 40,
      });
    }
  }

  if (composites.length > 0) {
    await sheet.composite(composites).png().toFile(path.join(outDir, '_sprite_sheet.png'));
    console.log(`  Sprite sheet: ${sheetW}x${sheetH}px with ${composites.length} sprites`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
