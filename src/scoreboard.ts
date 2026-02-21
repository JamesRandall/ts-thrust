import {drawText, bbcMicroColours} from "./rendering";

export interface ScoreEntry {
  score: number;
  name: string;
}

const STORAGE_KEY = "thrust-high-scores";

const DEFAULT_SCORES: ScoreEntry[] = [
  { score: 200000, name: "SPACELORD" },
  { score: 150000, name: "ADMIRAL" },
  { score: 100000, name: "COMMODORE" },
  { score: 50000,  name: "CAPTAIN" },
  { score: 20000,  name: "PILOT" },
  { score: 15000,  name: "CADET" },
  { score: 10000,  name: "NOVICE" },
  { score: 5000,   name: "MENACE" },
];

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 8) {
        return parsed;
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SCORES.map(e => ({ ...e }));
}

export function saveScores(scores: ScoreEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

/** Returns rank 0-7 if playerScore qualifies, or -1 if not */
export function getHighScoreRank(scores: ScoreEntry[], playerScore: number): number {
  for (let i = 0; i < scores.length; i++) {
    if (playerScore > scores[i].score) {
      return i;
    }
  }
  return -1;
}

/** Inserts at rank, shifts others down, keeps top 8 */
export function insertScore(scores: ScoreEntry[], rank: number, score: number, name: string): ScoreEntry[] {
  const result = scores.map(e => ({ ...e }));
  result.splice(rank, 0, { score, name });
  return result.slice(0, 8);
}

export function renderScoreboard(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  scores: ScoreEntry[],
  editingRank?: number,
  editingName?: string,
): void {
  // Title "TOP EIGHT THRUSTERS" centered, row 2
  const title = "TOP EIGHT THRUSTERS";
  const titleX = Math.floor((screenWidth - title.length * 8) / 2);
  drawText(ctx, title, titleX, 2 * 8, bbcMicroColours.green);

  // 8 score rows starting at row 5
  const startRow = 5;
  for (let i = 0; i < 8; i++) {
    const y = (startRow + i * 2) * 8;

    // Rank number (1-8)
    const rankStr = String(i + 1) + ".";
    const rankX = 48;
    drawText(ctx, rankStr, rankX, y, bbcMicroColours.yellow);

    // Score value - right-aligned in a field
    const entry = (editingRank !== undefined && i === editingRank)
      ? { score: scores.length > i ? scores[i].score : 0, name: editingName ?? "" }
      : scores[i];

    const scoreStr = String(entry.score);
    const scoreFieldX = 80;
    const scoreFieldW = 6 * 8; // 6 chars wide
    const scoreX = scoreFieldX + scoreFieldW - scoreStr.length * 8;
    drawText(ctx, scoreStr, scoreX, y, bbcMicroColours.yellow);

    // Name
    const nameX = scoreFieldX + scoreFieldW + 16;
    if (editingRank !== undefined && i === editingRank) {
      // Show editing name with blinking cursor
      const displayName = editingName ?? "";
      drawText(ctx, displayName, nameX, y, bbcMicroColours.green);
      // Blinking cursor using time
      const cursorVisible = Math.floor(Date.now() / 300) % 2 === 0;
      if (cursorVisible && displayName.length < 9) {
        const cursorX = nameX + displayName.length * 8;
        ctx.fillStyle = bbcMicroColours.green;
        ctx.fillRect(cursorX, y, 8, 5);
      }
    } else {
      drawText(ctx, entry.name, nameX, y, bbcMicroColours.green);
    }
  }

  // "PRESS SPACE BAR TO START" at bottom
  if (editingRank === undefined) {
    const bottomText = "PRESS SPACE BAR TO START";
    const bottomX = Math.floor((screenWidth - bottomText.length * 8) / 2);
    drawText(ctx, bottomText, bottomX, 23 * 8, bbcMicroColours.red);
  } else {
    const bottomText = "ENTER YOUR NAME";
    const bottomX = Math.floor((screenWidth - bottomText.length * 8) / 2);
    drawText(ctx, bottomText, bottomX, 23 * 8, bbcMicroColours.red);
  }
}
