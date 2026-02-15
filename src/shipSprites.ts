import ship00 from './sprites/ship_00.png'
import ship01 from './sprites/ship_01.png'
import ship02 from './sprites/ship_02.png'
import ship03 from './sprites/ship_03.png'
import ship04 from './sprites/ship_04.png'
import ship05 from './sprites/ship_05.png'
import ship06 from './sprites/ship_06.png'
import ship07 from './sprites/ship_07.png'
import ship08 from './sprites/ship_08.png'
import ship09 from './sprites/ship_09.png'
import ship10 from './sprites/ship_10.png'
import ship11 from './sprites/ship_11.png'
import ship12 from './sprites/ship_12.png'
import ship13 from './sprites/ship_13.png'
import ship14 from './sprites/ship_14.png'
import ship15 from './sprites/ship_15.png'
import ship16 from './sprites/ship_16.png'
import ship17 from './sprites/ship_17.png'
import ship18 from './sprites/ship_18.png'
import ship19 from './sprites/ship_19.png'
import ship20 from './sprites/ship_20.png'
import ship21 from './sprites/ship_21.png'
import ship22 from './sprites/ship_22.png'
import ship23 from './sprites/ship_23.png'
import ship24 from './sprites/ship_24.png'
import ship25 from './sprites/ship_25.png'
import ship26 from './sprites/ship_26.png'
import ship27 from './sprites/ship_27.png'
import ship28 from './sprites/ship_28.png'
import ship29 from './sprites/ship_29.png'
import ship30 from './sprites/ship_30.png'
import ship31 from './sprites/ship_31.png'

import gunUpLeft from './sprites/gun_up_left.png'
import gunUpRight from './sprites/gun_up_right.png'
import gunDownLeft from './sprites/gun_down_left.png'
import gunDownRight from './sprites/gun_down_right.png'

export interface TurretSprites {
  upLeft: ImageBitmap;
  upRight: ImageBitmap;
  downLeft: ImageBitmap;
  downRight: ImageBitmap;
}

export async function loadTurretSprites(): Promise<TurretSprites> {
  const [upLeft, upRight, downLeft, downRight] = await Promise.all([
    loadSprite(gunUpLeft),
    loadSprite(gunUpRight),
    loadSprite(gunDownLeft),
    loadSprite(gunDownRight),
  ]);
  return { upLeft, upRight, downLeft, downRight };
}

const spriteUrls: string[] = [
  ship00, ship01, ship02, ship03, ship04, ship05, ship06, ship07,
  ship08, ship09, ship10, ship11, ship12, ship13, ship14, ship15,
  ship16, ship17, ship18, ship19, ship20, ship21, ship22, ship23,
  ship24, ship25, ship26, ship27, ship28, ship29, ship30, ship31,
];

export type SpriteMask = { dx: number; dy: number }[];

export async function loadSprite(url: string): Promise<ImageBitmap> {
  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r < 128 && g < 128 && b < 128) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

export async function loadShipSprites(): Promise<{ sprites: ImageBitmap[]; masks: SpriteMask[] }> {
  const results = await Promise.all(spriteUrls.map(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < 128 && g < 128 && b < 128) {
        // Black → transparent
        data[i + 3] = 0;
      } else {
        // White → yellow (255, 255, 0)
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }

    // Extract opaque pixel offsets for collision mask
    const mask: SpriteMask = [];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;
        if (data[idx + 3] > 0) {
          mask.push({ dx: x, dy: y });
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    return { sprite: bitmap, mask };
  }));

  return {
    sprites: results.map(r => r.sprite),
    masks: results.map(r => r.mask),
  };
}
