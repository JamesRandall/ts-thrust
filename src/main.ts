import {renderLevel, drawStatusBar, drawText, drawRemappedSprite, rotationToSpriteIndex, WORLD_SCALE_X, WORLD_SCALE_Y} from "./rendering";
import {loadShipSprites, loadSprite, loadTurretSprites} from "./shipSprites";
import fuelPng from "./sprites/fuel.png";
import powerPlantPng from "./sprites/powerPlant.png";
import podStandPng from "./sprites/pod_stand.png";
import podPng from "./sprites/pod.png";
import shieldPng from "./sprites/shield.png";
import {levels} from "./levels";
import {createGame, tick, resetGame} from "./game";
import {createCollisionBuffer, renderCollisionBuffer, testCollision, testLineCollision, testRectCollision, CollisionResult} from "./collision";
import {renderBullets, removeBulletsHittingShip, removeCollidingBullets, renderPlayerBullets, processPlayerBulletCollisions} from "./bullets";
import {renderExplosions, spawnExplosion, orColours} from "./explosions";
import {renderFuelBeams} from "./fuelCollection";
import {handleGeneratorHit} from "./generator";
import {renderStars} from "./stars";
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
  const [{ sprites: shipSprites, masks: shipMasks, centers: shipCenters }, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, shieldSprite, podSprite] = await Promise.all([
    loadShipSprites(),
    loadSprite(fuelPng),
    loadTurretSprites(),
    loadSprite(powerPlantPng),
    loadSprite(podStandPng),
    loadSprite(shieldPng),
    loadSprite(podPng),
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

    // Planet self-destruct countdown reached 0
    if (game.planetKilled) {
      resetGame(game);
      game.planetKilled = false;
      requestAnimationFrame(frame);
      return;
    }

    // Camera from scroll state
    const camX = Math.round(game.scroll.windowPos.x * WORLD_SCALE_X);
    const camY = Math.round(game.scroll.windowPos.y * WORLD_SCALE_Y);
    const podDetached = game.physics.state.podAttached;
    // Remove pod stand from collision buffer as soon as tractor beam starts (or pod attached)
    const podRemovedFromCollision = podDetached || game.tractorBeamStarted;
    renderCollisionBuffer(collisionBuf, game.level, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.destroyedTurrets, game.destroyedFuel, game.generator.destroyed, podRemovedFromCollision);
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
    // Generator hit
    if (bulletHits.hitGenerator && !game.generator.destroyed) {
      handleGeneratorHit(game.generator, game.explosions, bulletHits.generatorHitX, bulletHits.generatorHitY);
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

    // Tether line + pod collision with terrain (only when pod is attached, not during tractor beam)
    if (collision === CollisionResult.None && game.physics.state.podAttached) {
      const shipCX = Math.round(game.player.x * WORLD_SCALE_X - camX);
      const shipCY = Math.round(game.player.y * WORLD_SCALE_Y - camY);
      const podCX = Math.round(game.physics.state.podX * WORLD_SCALE_X - camX);
      const podCY = Math.round(game.physics.state.podY * WORLD_SCALE_Y - camY);

      // Test tether line
      if (testLineCollision(collisionImageData, shipCX, shipCY, podCX, podCY)) {
        resetGame(game);
      }
      // Test pod sprite area
      else {
        const podLeft = podCX - Math.floor(podSprite.width / 2);
        const podTop = podCY - Math.floor(podSprite.height / 2);
        if (testRectCollision(collisionImageData, podLeft, podTop, podSprite.width, podSprite.height)) {
          resetGame(game);
        }
      }
    }

    // Bullet-ship collision — always remove bullets that hit, only kill player if shield is down
    const bulletHitShip = removeBulletsHittingShip(game.turretFiring.bullets, shipMasks[spriteIdx], shipScreenX, shipScreenY, camX, camY);
    if (bulletHitShip && !game.shieldActive) {
      resetGame(game);
    }

    // Render visible frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    renderStars(ctx, game.starField, camX, camY);

    renderLevel(ctx, game.level, game.player.x, game.player.y, game.player.rotation, shipSprites, shipCenters, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.shieldActive ? shieldSprite : undefined, game.destroyedTurrets, game.destroyedFuel, game.generator.destroyed, game.generator.visible, podDetached);

    renderBullets(ctx, game.turretFiring.bullets, camX, camY, game.level.terrainColor);
    renderPlayerBullets(ctx, game.playerShooting, camX, camY, game.level.terrainColor);
    renderExplosions(ctx, game.explosions, camX, camY);
    renderFuelBeams(ctx, game.fuelCollection, shipScreenX, shipScreenY);

    // Tractor beam / attachment line + attached pod rendering
    if (game.podLineExists || game.physics.state.podAttached) {
      const shipCX = Math.round(game.player.x * WORLD_SCALE_X - camX);
      const shipCY = Math.round(game.player.y * WORLD_SCALE_Y - camY);

      let podCX: number, podCY: number;
      if (game.physics.state.podAttached) {
        podCX = Math.round(game.physics.state.podX * WORLD_SCALE_X - camX);
        podCY = Math.round(game.physics.state.podY * WORLD_SCALE_Y - camY);
      } else {
        // Tractor beam to pod circle center on stand
        // Stand drawn at (pedestal.x, pedestal.y - 1px), pod circle center at (5, 5) within sprite
        podCX = Math.round(game.level.podPedestal.x * WORLD_SCALE_X - camX + Math.floor(podStandSprite.width / 2));
        podCY = Math.round(game.level.podPedestal.y * WORLD_SCALE_Y - camY - 1 + Math.floor(podSprite.height / 2));
      }

      // Draw line between ship and pod — Bresenham with coarse 2×2 pixel blocks
      ctx.fillStyle = game.level.terrainColor;
      {
        let x0 = shipCX, y0 = shipCY, x1 = podCX, y1 = podCY;
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

      // Draw attached pod sprite
      if (game.physics.state.podAttached) {
        drawRemappedSprite(ctx, podSprite, podCX - Math.floor(podSprite.width / 2), podCY - Math.floor(podSprite.height / 2), game.level.objectColor, game.level.terrainColor);
      }
    }

    drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);

    // Planet self-destruct countdown display
    if (game.generator.planetCountdown >= 0) {
      const countdownStr = String(game.generator.planetCountdown);
      const cx = Math.floor((INTERNAL_W - countdownStr.length * 8) / 2);
      const cy = Math.floor(INTERNAL_H / 2);
      drawText(ctx, countdownStr, cx, cy, bbcMicroColours.white);
    }

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
