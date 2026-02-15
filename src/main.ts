import {renderLevel, drawStatusBar} from "./rendering";
import {loadShipSprites} from "./shipSprites";
import {levels} from "./levels";
import {createGame, tick} from "./game";

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

const game = createGame(levels[0]);

const keys = new Set<string>();
window.addEventListener("keydown", (e) => { keys.add(e.code); e.preventDefault(); });
window.addEventListener("keyup", (e) => { keys.delete(e.code); });

let lastTime = -1;

async function startGame() {
  const shipSprites = await loadShipSprites();

  function frame(time: number) {
    const dt = lastTime < 0 ? 0 : (time - lastTime) / 1000;
    lastTime = time;

    tick(game, dt, keys);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    renderLevel(ctx, game.level, game.player.x, game.player.y, game.player.rotation, shipSprites, INTERNAL_W, INTERNAL_H);

    drawStatusBar(ctx, INTERNAL_W, game.fuel, game.lives, game.score);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

startGame();
