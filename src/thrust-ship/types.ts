export interface DecodedSprite {
  pixels: Array<{ x: number; y: number }>;
  width: number;
  height: number;
}

export type ShipAngle = number; // 0-31 inclusive, wraps with AND 0x1F
