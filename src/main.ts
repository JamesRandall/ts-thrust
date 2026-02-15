import {renderLevel, drawStatusBar, drawText, rotationToSpriteIndex, WORLD_SCALE_X, WORLD_SCALE_Y} from "./rendering";
import {loadShipSprites, loadSprite, loadTurretSprites} from "./shipSprites";
import fuelPng from "./sprites/fuel.png";
import powerPlantPng from "./sprites/powerPlant.png";
import podStandPng from "./sprites/pod_stand.png";
import shieldPng from "./sprites/shield.png";
import {levels} from "./levels";
import {createGame, tick, resetGame} from "./game";
import {createCollisionBuffer, renderCollisionBuffer, testCollision, CollisionResult} from "./collision";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const INTERNAL_W = 320;
const INTERNAL_H = 256;

canvas.width = INTERNAL_W;
canvas.height = INTERNAL_H;
ctx.imageSmoothingEnabled = false;

function resize() {
  const scaleX = Math.floor(window.innerWidth / INTERNAL_W);
  const scaleY = Math.floor(window.innerHeight / INTERNAL_H);
  const scale = Math.max(1, Math.min(scaleX, scaleY));

  canvas.style.width = `${INTERNAL_W * scale}px`;
  canvas.style.height = `${INTERNAL_H * scale}px`;
}

window.addEventListener("resize", resize);
resize();

let game = createGame(levels[0]);
const collisionBuf = createCollisionBuffer(INTERNAL_W, INTERNAL_H);

const keys = new Set<string>();
window.addEventListener("keydown", (e) => { keys.add(e.code); e.preventDefault(); });
window.addEventListener("keyup", (e) => { keys.delete(e.code); });

let lastTime = -1;
let fps = 0;

async function startGame() {
  const [{ sprites: shipSprites, masks: shipMasks, centers: shipCenters }, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, shieldSprite] = await Promise.all([
    loadShipSprites(),
    loadSprite(fuelPng),
    loadTurretSprites(),
    loadSprite(powerPlantPng),
    loadSprite(podStandPng),
    loadSprite(shieldPng),
  ]);

  function frame(time: number) {
    const dt = lastTime < 0 ? 0 : (time - lastTime) / 1000;
    lastTime = time;

    // Number keys switch level
    for (let i = 0; i < levels.length; i++) {
      if (keys.has(`Digit${i + 1}`)) {
        game = createGame(levels[i]);
        keys.delete(`Digit${i + 1}`);
        break;
      }
    }

    tick(game, dt, keys);

    // Camera from scroll state
    const camX = Math.round(game.scroll.windowPos.x * WORLD_SCALE_X);
    const camY = Math.round(game.scroll.windowPos.y * WORLD_SCALE_Y);
    renderCollisionBuffer(collisionBuf, game.level, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite);

    const spriteIdx = rotationToSpriteIndex(game.player.rotation);
    const center = shipCenters[spriteIdx];
    const shipScreenX = Math.round(game.player.x * WORLD_SCALE_X - camX - center.x);
    const shipScreenY = Math.round(game.player.y * WORLD_SCALE_Y - camY - center.y);

    const collision = testCollision(collisionBuf, shipMasks[spriteIdx], shipScreenX, shipScreenY);
    game.collisionResult = collision;

    if (collision !== CollisionResult.None) {
      resetGame(game);
    }

    // Render visible frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    renderLevel(ctx, game.level, game.player.x, game.player.y, game.player.rotation, shipSprites, shipCenters, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.shieldActive ? shieldSprite : undefined);

    drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);

    // FPS counter
    if (dt > 0) fps = fps * 0.95 + (1 / dt) * 0.05;
    const fpsText = String(Math.round(fps));
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, INTERNAL_H - 7, fpsText.length * 8 + 2, 7);
    drawText(ctx, fpsText, 1, INTERNAL_H - 6, "#ffffff");

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

startGame();
