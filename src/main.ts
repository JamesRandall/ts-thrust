import {renderLevel} from "./rendering";
import {playerShip} from "./models";
import {levels} from "./levels";

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

const level = levels[0];
let playerX = level.startingPosition.x;
let playerY = level.startingPosition.y;
let playerRotation = 0;

const keys = new Set<string>();
window.addEventListener("keydown", (e) => { keys.add(e.code); e.preventDefault(); });
window.addEventListener("keyup", (e) => { keys.delete(e.code); });

const MOVE_SPEED = 60;

let lastTime = -1;

function frame(time: number) {
  const dt = lastTime < 0 ? 0 : (time - lastTime) / 1000;
  lastTime = time;

  if (keys.has("ArrowLeft"))  playerX -= MOVE_SPEED * dt;
  if (keys.has("ArrowRight")) playerX += MOVE_SPEED * dt;
  if (keys.has("ArrowUp"))    playerY -= MOVE_SPEED * dt;
  if (keys.has("ArrowDown"))  playerY += MOVE_SPEED * dt;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  renderLevel(ctx, level, playerX, playerY, playerRotation, playerShip, INTERNAL_W, INTERNAL_H);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
