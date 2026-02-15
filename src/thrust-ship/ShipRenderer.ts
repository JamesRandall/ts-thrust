import { DecodedSprite, ShipAngle } from "./types";
import { decodeAllSprites, SHIELD_SPRITE_ID, POD_SPRITE_ID } from "./ShipSpriteDecoder";

export class ShipRenderer {
  private sprites: Map<number, DecodedSprite>;
  private scale: number;

  constructor(scale: number = 1) {
    this.scale = scale;
    this.sprites = decodeAllSprites();
  }

  /**
   * Draw the ship at the given screen position and angle.
   * MODE 1 pixels are 2:1 aspect ratio (each logical pixel is 2 physical pixels wide).
   */
  render(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    angle: ShipAngle,
    shieldActive: boolean,
    colour: string = "#FFFFFF"
  ): void {
    const spriteId = angle & 0x1F;
    const sprite = this.sprites.get(spriteId);
    if (!sprite) return;

    const pixelW = this.scale * 2; // MODE 1 pixels are double-wide
    const pixelH = this.scale;

    // Centre the sprite on the position
    const offsetX = screenX - (sprite.width * pixelW) / 2;
    const offsetY = screenY - (sprite.height * pixelH) / 2;

    ctx.fillStyle = colour;
    for (const pixel of sprite.pixels) {
      ctx.fillRect(
        Math.round(offsetX + pixel.x * pixelW),
        Math.round(offsetY + pixel.y * pixelH),
        pixelW,
        pixelH
      );
    }

    // Draw shield overlay if active
    if (shieldActive) {
      const shield = this.sprites.get(SHIELD_SPRITE_ID);
      if (shield) {
        const shieldOffsetX = screenX - (shield.width * pixelW) / 2;
        const shieldOffsetY = screenY - (shield.height * pixelH) / 2;

        ctx.fillStyle = "#00FFFF";
        for (const pixel of shield.pixels) {
          ctx.fillRect(
            Math.round(shieldOffsetX + pixel.x * pixelW),
            Math.round(shieldOffsetY + pixel.y * pixelH),
            pixelW,
            pixelH
          );
        }
      }
    }
  }

  getSprite(id: number): DecodedSprite | undefined {
    return this.sprites.get(id);
  }
}
