import {renderLevel, drawStatusBar, drawText, drawRemappedSprite, rotationToSpriteIndex, WORLD_SCALE_X, WORLD_SCALE_Y} from "./rendering";
import {loadShipSprites, loadSprite, loadTurretSprites} from "./shipSprites";
import fuelPng from "./sprites/fuel.png";
import powerPlantPng from "./sprites/powerPlant.png";
import podStandPng from "./sprites/pod_stand.png";
import podPng from "./sprites/pod.png";
import shieldPng from "./sprites/shield.png";
import {levels} from "./levels";
import {createGame, tick, retryLevel, triggerMessage, advanceToNextLevel, missionComplete, startTeleport, MESSAGE_DURATION, destroyPlayerShip, destroyAttachedPod} from "./game";
import {createCollisionBuffer, renderCollisionBuffer, testCollision, testLineCollision, testRectCollision, CollisionResult} from "./collision";
import {renderBullets, removeBulletsHittingShip, removeCollidingBullets, renderPlayerBullets, processPlayerBulletCollisions} from "./bullets";
import {renderExplosions, spawnExplosion, orColours} from "./explosions";
import {renderFuelBeams} from "./fuelCollection";
import {handleGeneratorHit} from "./generator";
import {renderStars} from "./stars";
import {bbcMicroColours} from "./rendering";
import {createTitleScreen, resetTitleScreen, updateTitleScreen, renderTitleScreen} from "./titleScreen";
import {PostProcessor} from "./postProcessing";
import {ThrustSounds} from "./sound";
import {loadScores, saveScores, getHighScoreRank, insertScore, renderScoreboard, ScoreEntry} from "./scoreboard";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const ppCanvas = document.getElementById("postprocess") as HTMLCanvasElement;

const INTERNAL_W = 320;
const INTERNAL_H = 256;

canvas.width = INTERNAL_W;
canvas.height = INTERNAL_H;
ctx.imageSmoothingEnabled = false;

function resize() {
  const scaleX = Math.floor(window.innerWidth / INTERNAL_W);
  const scaleY = Math.floor(window.innerHeight / INTERNAL_H);
  const scale = Math.max(1, Math.min(scaleX, scaleY));

  const w = `${INTERNAL_W * scale}px`;
  const h = `${INTERNAL_H * scale}px`;
  canvas.style.width = w;
  canvas.style.height = h;
  ppCanvas.style.width = w;
  ppCanvas.style.height = h;
}

window.addEventListener("resize", resize);
resize();

let game = createGame(levels[0]);
const collisionBuf = createCollisionBuffer(INTERNAL_W, INTERNAL_H);

const keys = new Set<string>();
const charQueue: string[] = [];
let highScoreEntry: { active: boolean; rank: number; score: number; name: string; scores: ScoreEntry[] } | null = null;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (highScoreEntry?.active) {
    charQueue.push(e.key);
  }
  e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); });

const title = createTitleScreen();

let lastTime = -1;
let fps = 0;
let showFps = false;
let paused = false;

const postProcessor = new PostProcessor(canvas, ppCanvas, INTERNAL_W, INTERNAL_H);
const sounds = new ThrustSounds();

// Teleport animation constants
const TELEPORT_FRAME_DURATION = 1 / 25;  // 40ms per step (half speed)
const TELEPORT_VISIBILITY_THRESHOLD = 3;
const TELEPORT_STRIP_HEIGHT = 8;
const TELEPORT_STRIP_SPACING = 8;
const TELEPORT_DIAGONAL_OFFSET = 4;

function drawTeleportEffect(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  currentSize: number,
  color: string,
) {
  // Origin is offset diagonally so the 8px strips are centered on the ship/pod
  const ox = cx - TELEPORT_DIAGONAL_OFFSET;
  const oy = cy - TELEPORT_DIAGONAL_OFFSET;
  ctx.fillStyle = color;

  // Draw ALL sizes from 1 to currentSize (accumulated cross pattern).
  // The original uses XOR rendering which naturally accumulates; we redraw each frame
  // so we explicitly draw all sizes. This creates the graduated thickness where
  // strips cluster near center (wider blocks) and thin out toward the tips.
  for (let s = 1; s <= currentSize; s++) {
    for (let i = 0; i < s; i++) {
      const offset = s + i * TELEPORT_STRIP_SPACING;
      // Right arm: vertical strips extending right from central 8px zone
      ctx.fillRect(ox + TELEPORT_STRIP_HEIGHT - 1 + offset, oy, 1, TELEPORT_STRIP_HEIGHT);
      // Left arm: vertical strips extending left
      ctx.fillRect(ox - offset, oy, 1, TELEPORT_STRIP_HEIGHT);
      // Bottom arm: horizontal strips extending down from central 8px zone
      ctx.fillRect(ox, oy + TELEPORT_STRIP_HEIGHT - 1 + offset, TELEPORT_STRIP_HEIGHT, 1);
      // Top arm: horizontal strips extending up
      ctx.fillRect(ox, oy - offset, TELEPORT_STRIP_HEIGHT, 1);
    }
  }
}

async function startGame() {
  // Init WebGPU post-processing (non-blocking — gracefully degrades if unavailable)
  const ppReady = await postProcessor.init().catch(() => false);

  const [{ sprites: shipSprites, masks: shipMasks, centers: shipCenters }, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, shieldSprite, podSprite] = await Promise.all([
    loadShipSprites(),
    loadSprite(fuelPng),
    loadTurretSprites(),
    loadSprite(powerPlantPng),
    loadSprite(podStandPng),
    loadSprite(shieldPng),
    loadSprite(podPng),
  ]);

  function renderScene(hideShip?: boolean) {
    const camX = Math.round(game.scroll.windowPos.x * WORLD_SCALE_X);
    const camY = Math.round(game.scroll.windowPos.y * WORLD_SCALE_Y);
    const podDetached = game.physics.state.podAttached;

    // Hide ship when destroyed in death sequence
    const shouldHideShip = hideShip || game.deathSequence?.shipDestroyed;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!title.active && !highScoreEntry?.active) {
      renderStars(ctx, game.starField, camX, camY);
    }

    renderLevel(ctx, game.level, game.player.x, game.player.y, game.player.rotation, shipSprites, shipCenters, camX, camY, fuelSprite, turretSprites, powerPlantSprite, podStandSprite, game.shieldActive ? shieldSprite : undefined, game.destroyedTurrets, game.destroyedFuel, game.generator.destroyed, game.generator.visible, podDetached, shouldHideShip);

    renderBullets(ctx, game.turretFiring.bullets, camX, camY, game.level.terrainColor);
    renderPlayerBullets(ctx, game.playerShooting, camX, camY, game.level.terrainColor);
    renderExplosions(ctx, game.explosions, camX, camY);

    const spriteIdx = rotationToSpriteIndex(game.player.rotation);
    const center = shipCenters[spriteIdx];
    const shipScreenX = Math.round(game.player.x * WORLD_SCALE_X - camX - center.x);
    const shipScreenY = Math.round(game.player.y * WORLD_SCALE_Y - camY - center.y);
    renderFuelBeams(ctx, game.fuelCollection, shipScreenX, shipScreenY);

    // Tractor beam / attachment line + attached pod rendering (skip during teleport)
    if (!game.teleport && (game.podLineExists || game.physics.state.podAttached)) {
      const shipCX = Math.round(game.player.x * WORLD_SCALE_X - camX);
      const shipCY = Math.round(game.player.y * WORLD_SCALE_Y - camY);

      let podCX: number, podCY: number;
      if (game.physics.state.podAttached) {
        podCX = Math.round(game.physics.state.podX * WORLD_SCALE_X - camX);
        podCY = Math.round(game.physics.state.podY * WORLD_SCALE_Y - camY);
      } else {
        podCX = Math.round(game.level.podPedestal.x * WORLD_SCALE_X - camX + Math.floor(podStandSprite.width / 2));
        podCY = Math.round(game.level.podPedestal.y * WORLD_SCALE_Y - camY - 1 + Math.floor(podSprite.height / 2));
      }

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
  }

  function drawCenteredMessage(text: string) {
    const cx = Math.floor((INTERNAL_W - text.length * 8) / 2);
    const cy = 128;
    drawText(ctx, text, cx, cy, bbcMicroColours.white);
  }

  function processOrbitEscape() {
    if (game.fuelEmpty) {
      triggerMessage(game, "OUT OF FUEL", 'game-over');
    } else if (game.physics.state.podAttached) {
      missionComplete(game);
      triggerMessage(game, "MISSION COMPLETE", 'next-level');
    } else if (game.generator.planetCountdown >= 0) {
      game.lives--;
      if (game.lives <= 0) triggerMessage(game, "GAME OVER", 'game-over');
      else triggerMessage(game, "PLANET DESTROYED", 'next-level');
    } else {
      game.lives--;
      if (game.lives <= 0) triggerMessage(game, "GAME OVER", 'game-over');
      else triggerMessage(game, "MISSION INCOMPLETE", 'retry');
    }
  }

  function handlePostProcessKeys() {
    if (ppReady && keys.has("BracketRight")) {
      postProcessor.cycleEffect(1);
      keys.delete("BracketRight");
    }
    if (ppReady && keys.has("BracketLeft")) {
      postProcessor.cycleEffect(-1);
      keys.delete("BracketLeft");
    }
  }

  function postProcessFrame(time: number) {
    postProcessor.render(time);
  }

  function frame(time: number) {
    const dt = lastTime < 0 ? 0 : (time - lastTime) / 1000;
    lastTime = time;
    handlePostProcessKeys();

    // Title screen — show terrain with text overlay, no ship
    if (title.active) {
      updateTitleScreen(title, dt);
      renderScene(true);
      renderTitleScreen(ctx, title, INTERNAL_W);

      if (keys.size > 0) {
        keys.clear();
        title.active = false;
        sounds.resume();
        startTeleport(game, false);
      }

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // High score entry mode
    if (highScoreEntry?.active) {
      sounds.stopAll();
      renderScene(true);

      // Build a preview of scores with the new entry inserted
      const previewScores = insertScore(highScoreEntry.scores, highScoreEntry.rank, highScoreEntry.score, highScoreEntry.name);

      renderScoreboard(ctx, INTERNAL_W, previewScores, highScoreEntry.rank, highScoreEntry.name);

      // Process character input from queue
      while (charQueue.length > 0) {
        const ch = charQueue.shift()!;
        if (ch === "Enter") {
          // Confirm name
          const finalName = highScoreEntry.name || "PLAYER";
          const finalScores = insertScore(highScoreEntry.scores, highScoreEntry.rank, highScoreEntry.score, finalName);
          saveScores(finalScores);
          highScoreEntry = null;
          keys.clear();
          resetTitleScreen(title);
          title.page = 1;
          game = createGame(levels[0], 0);
          break;
        } else if (ch === "Backspace") {
          highScoreEntry.name = highScoreEntry.name.slice(0, -1);
        } else if (ch.length === 1 && /^[a-zA-Z]$/.test(ch) && highScoreEntry.name.length < 9) {
          highScoreEntry.name += ch.toUpperCase();
        }
      }

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // Game over state — wait for any key to restart
    if (game.gameOver) {
      sounds.stopAll();

      // Check for high score on first frame of game over
      if (!highScoreEntry) {
        const scores = loadScores();
        const rank = getHighScoreRank(scores, game.score);
        if (rank >= 0) {
          highScoreEntry = { active: true, rank, score: game.score, name: "", scores };
          game = createGame(levels[0], 0);
          charQueue.length = 0; // clear any queued chars
          keys.clear();
          postProcessFrame(time);
          requestAnimationFrame(frame);
          return;
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);
      drawCenteredMessage("GAME OVER");

      // Check for any key to restart
      if (keys.size > 0) {
        keys.clear();
        resetTitleScreen(title);
        game = createGame(levels[0], 0);
      }

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // Message overlay — black screen with status bar and text
    if (game.messageTimer > 0) {
      sounds.stopAll();
      game.messageTimer--;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);
      if (game.messageText) {
        drawCenteredMessage(game.messageText);
      }

      if (game.messageTimer === 0 && game.pendingAction) {
        switch (game.pendingAction) {
          case 'retry':
            retryLevel(game);
            break;
          case 'next-level':
            game = advanceToNextLevel(game);
            break;
          case 'game-over':
            game.gameOver = true;
            break;
        }
        game.pendingAction = null;
        game.messageText = null;
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

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // Teleport animation
    if (game.teleport) {
      sounds.stopEngine();
      sounds.stopShield();
      game.teleport.timer += dt;
      while (game.teleport.timer >= TELEPORT_FRAME_DURATION) {
        game.teleport.timer -= TELEPORT_FRAME_DURATION;
        game.teleport.step++;
      }

      if (game.teleport.step >= 12) {
        // Animation complete
        const wasDisappearing = game.teleport.isDisappearing;
        game.teleport = null;
        if (wasDisappearing) {
          processOrbitEscape();
        }
        renderScene();
      } else {
        // Calculate size: expand 1→6, contract 6→1
        const step = game.teleport.step;
        const size = step < 6 ? step + 1 : 12 - step;
        const isExpansion = step < 6;

        // Ship visibility per spec table
        const shipVisible = size >= TELEPORT_VISIBILITY_THRESHOLD ||
          (game.teleport.isDisappearing ? isExpansion : !isExpansion);

        renderScene(!shipVisible);

        // Draw teleport rectangles
        drawTeleportEffect(ctx, game.teleport.shipCX, game.teleport.shipCY, size, bbcMicroColours.yellow);
        if (game.teleport.hasPod) {
          drawTeleportEffect(ctx, game.teleport.podCX, game.teleport.podCY, size, bbcMicroColours.white);
        }
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

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // Pause toggle
    if (keys.has("KeyP")) {
      paused = !paused;
      keys.delete("KeyP");
    }

    if (paused) {
      renderScene();
      drawCenteredMessage("PAUSED");

      postProcessFrame(time);
      requestAnimationFrame(frame);
      return;
    }

    // Number keys switch level (debug)
    for (let i = 0; i < levels.length; i++) {
      if (keys.has(`Digit${i + 1}`)) {
        sounds.stopAll();
        game = createGame(levels[i], i);
        keys.delete(`Digit${i + 1}`);
        break;
      }
    }

    tick(game, dt, keys);
    sounds.tick();

    // --- Sound triggers from game tick events ---
    const dying = game.deathSequence !== null;
    const thrustActive = !dying && keys.has("KeyW") && !game.fuelEmpty;
    const shieldKeyDown = !dying && keys.has("Space") && !game.fuelEmpty;

    // Engine: continuous noise while thrusting
    if (thrustActive && !shieldKeyDown) {
      sounds.startEngine();
    } else {
      sounds.stopEngine();
    }

    // Shield/tractor: continuous hum while shield key held
    if (shieldKeyDown) {
      sounds.startShield();
    } else {
      sounds.stopShield();
    }

    // Stop continuous sounds on death
    if (dying) {
      sounds.stopEngine();
      sounds.stopShield();
    }

    // Player gun fired
    if (game.playerShooting.firedThisTick) {
      sounds.playOwnGun();
    }

    // Hostile turret fired
    if (game.turretFiring.turretsFiredThisTick) {
      sounds.playHostileGun();
    }

    // Fuel collected
    if (game.fuelCollection.collectedThisTick) {
      sounds.playCollect();
    }

    // Countdown beep
    if (game.generator.countdownBeepThisTick) {
      sounds.playCountdown();
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
      sounds.playExplosion();
    }
    // Fuel explosions: type 1 ($FF) = both landscape + object colours combined
    const fuelExplosionColour = orColours(game.level.terrainColor, game.level.objectColor);
    for (const idx of bulletHits.hitFuel) {
      game.destroyedFuel.add(idx);
      const f = game.level.fuel[idx];
      spawnExplosion(game.explosions, f.x + 2, f.y + 4, fuelExplosionColour);
      game.score += 150;
      sounds.playExplosion();
    }
    // Generator hit
    if (bulletHits.hitGenerator && !game.generator.destroyed) {
      handleGeneratorHit(game.generator, game.explosions, bulletHits.generatorHitX, bulletHits.generatorHitY);
    }

    const spriteIdx = rotationToSpriteIndex(game.player.rotation);
    const center = shipCenters[spriteIdx];
    const shipScreenX = Math.round(game.player.x * WORLD_SCALE_X - camX - center.x);
    const shipScreenY = Math.round(game.player.y * WORLD_SCALE_Y - camY - center.y);

    // --- Collision detection — skip during death sequence ---
    if (!game.deathSequence) {
      const collision = testCollision(collisionBuf, shipMasks[spriteIdx], shipScreenX, shipScreenY);
      game.collisionResult = collision;

      // Ship collision → destroy ship (ship dies first)
      if (collision !== CollisionResult.None) {
        destroyPlayerShip(game);
        sounds.playExplosion();
      }

      // Tether line + pod collision with terrain (only when pod is attached, not during tractor beam)
      if (collision === CollisionResult.None && game.physics.state.podAttached) {
        const shipCX = Math.round(game.player.x * WORLD_SCALE_X - camX);
        const shipCY = Math.round(game.player.y * WORLD_SCALE_Y - camY);
        const podCX = Math.round(game.physics.state.podX * WORLD_SCALE_X - camX);
        const podCY = Math.round(game.physics.state.podY * WORLD_SCALE_Y - camY);

        // Test tether line
        if (testLineCollision(collisionImageData, shipCX, shipCY, podCX, podCY)) {
          destroyAttachedPod(game);
          sounds.playExplosion();
        }
        // Test pod sprite area
        else {
          const podLeft = podCX - Math.floor(podSprite.width / 2);
          const podTop = podCY - Math.floor(podSprite.height / 2);
          if (testRectCollision(collisionImageData, podLeft, podTop, podSprite.width, podSprite.height)) {
            destroyAttachedPod(game);
            sounds.playExplosion();
          }
        }
      }

      // Bullet-ship collision — always remove bullets that hit, only kill player if shield is down
      const bulletHitShip = removeBulletsHittingShip(game.turretFiring.bullets, shipMasks[spriteIdx], shipScreenX, shipScreenY, camX, camY);
      if (bulletHitShip && !game.shieldActive) {
        destroyPlayerShip(game);
        sounds.playExplosion();
      }
    }

    // Planet self-destruct countdown reached 0
    if (game.planetKilled) {
      game.planetKilled = false;
      if (!game.deathSequence) {
        destroyPlayerShip(game);
        sounds.playExplosion();
      }
    }

    // --- Process orbit escape — start disappear teleport ---
    if (game.escapedToOrbit) {
      game.escapedToOrbit = false;
      sounds.stopEngine();
      sounds.stopShield();
      sounds.playEnterOrbit();
      startTeleport(game, true);
    }

    // --- Process death (levelEndedFlag) ---
    if (game.levelEndedFlag) {
      game.levelEndedFlag = false;
      if (game.fuelEmpty) {
        triggerMessage(game, "OUT OF FUEL", 'game-over');
      } else {
        game.lives--;
        if (game.lives <= 0) {
          triggerMessage(game, "GAME OVER", 'game-over');
        } else if (game.generator.planetCountdown >= 0 || game.planetKilled) {
          triggerMessage(game, "PLANET DESTROYED", 'next-level');
        } else {
          retryLevel(game);
        }
      }
    }

    // Render visible frame
    renderScene();

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

    postProcessFrame(time);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

startGame();
