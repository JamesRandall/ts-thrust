import {renderLevel, drawStatusBar, drawText, rotationToSpriteIndex, WORLD_SCALE_X, WORLD_SCALE_Y} from "./rendering";
import {loadShipSprites, loadSprite, loadTurretSprites} from "./shipSprites";
import fuelPng from "./sprites/fuel.png";
import powerPlantPng from "./sprites/powerPlant.png";
import podStandPng from "./sprites/pod_stand.png";
import shieldPng from "./sprites/shield.png";
import {levels} from "./levels";
import {createGame, tick, resetGame} from "./game";
import {createCollisionBuffer, renderCollisionBuffer, testCollision, CollisionResult} from "./collision";
import {renderBullets, removeBulletsHittingShip, removeCollidingBullets, renderPlayerBullets, processPlayerBulletCollisions} from "./bullets";
import {renderExplosions, spawnExplosion, orColours} from "./explosions";
import {renderFuelBeams} from "./fuelCollection";
import {bbcMicroColours} from "./rendering";

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
let showFps = false;

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
    renderCollisionBuffer(collisionBuf, game.level, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.destroyedTurrets, game.destroyedFuel);
    const collisionImageData = collisionBuf.ctx.getImageData(0, 0, collisionBuf.width, collisionBuf.height);

    // Remove bullets that hit terrain/objects
    removeCollidingBullets(game.turretFiring, collisionImageData, camX, camY);

    // Player bullet collision via collision buffer — detects terrain hits and object destruction
    const bulletHits = processPlayerBulletCollisions(
      game.playerShooting, collisionImageData, camX, camY,
      game.level.turrets, game.level.fuel,
      game.destroyedTurrets, game.destroyedFuel,
    );
    // Gun explosions: type 2 ($0F) = colour 1 = yellow
    for (const idx of bulletHits.hitTurrets) {
      game.destroyedTurrets.add(idx);
      const t = game.level.turrets[idx];
      spawnExplosion(game.explosions, t.x + 2, t.y + 4, bbcMicroColours.yellow);
      game.score += 750;
    }
    // Fuel explosions: type 1 ($FF) = both landscape + object colours combined
    const fuelExplosionColour = orColours(game.level.terrainColor, game.level.objectColor);
    for (const idx of bulletHits.hitFuel) {
      game.destroyedFuel.add(idx);
      const f = game.level.fuel[idx];
      spawnExplosion(game.explosions, f.x + 2, f.y + 4, fuelExplosionColour);
      game.score += 150;
    }

    const spriteIdx = rotationToSpriteIndex(game.player.rotation);
    const center = shipCenters[spriteIdx];
    const shipScreenX = Math.round(game.player.x * WORLD_SCALE_X - camX - center.x);
    const shipScreenY = Math.round(game.player.y * WORLD_SCALE_Y - camY - center.y);

    const collision = testCollision(collisionBuf, shipMasks[spriteIdx], shipScreenX, shipScreenY);
    game.collisionResult = collision;

    if (collision !== CollisionResult.None) {
      resetGame(game);
    }

    // Bullet-ship collision — always remove bullets that hit, only kill player if shield is down
    const bulletHitShip = removeBulletsHittingShip(game.turretFiring.bullets, shipMasks[spriteIdx], shipScreenX, shipScreenY, camX, camY);
    if (bulletHitShip && !game.shieldActive) {
      resetGame(game);
    }

    // Render visible frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    renderLevel(ctx, game.level, game.player.x, game.player.y, game.player.rotation, shipSprites, shipCenters, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.shieldActive ? shieldSprite : undefined, game.destroyedTurrets, game.destroyedFuel);

    renderBullets(ctx, game.turretFiring.bullets, camX, camY, game.level.terrainColor);
    renderPlayerBullets(ctx, game.playerShooting, camX, camY, game.level.terrainColor);
    renderExplosions(ctx, game.explosions, camX, camY);
    renderFuelBeams(ctx, game.fuelCollection, shipScreenX, shipScreenY);

    drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);

    // FPS counter (toggle with F)
    if (keys.has("KeyF")) {
      showFps = !showFps;
      keys.delete("KeyF");
    }
    if (showFps) {
      if (dt > 0) fps = fps * 0.95 + (1 / dt) * 0.05;
      const fpsText = String(Math.round(fps));
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, INTERNAL_H - 7, fpsText.length * 8 + 2, 7);
      drawText(ctx, fpsText, 1, INTERNAL_H - 6, "#ffffff");
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

startGame();
