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

const TITLE_ROW = 8;
const SCORES_START_ROW = 10;
const SCORES_ROW_SPACING = 1;
const BOTTOM_ROW = 19;
const CHAR_W = 8;

function rowY(row: number): number {
  return row * CHAR_W;
}

export function renderScoreboard(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  scores: ScoreEntry[],
  editingRank?: number,
  editingName?: string,
): void {
  // Title "TOP EIGHT THRUSTERS" centered
  const title = "TOP EIGHT THRUSTERS";
  const titleX = Math.floor((screenWidth - title.length * CHAR_W) / 2);
  drawText(ctx, title, titleX, rowY(TITLE_ROW), bbcMicroColours.green);

  // 8 score rows
  for (let i = 0; i < 8; i++) {
    const row = SCORES_START_ROW + i * SCORES_ROW_SPACING;
    const y = rowY(row);

    // Rank number (1-8)
    const rankStr = String(i + 1) + ".";
    const rankX = titleX - CHAR_W;
    drawText(ctx, rankStr, rankX, y, bbcMicroColours.yellow);

    // Score value - right-aligned in a field
    const entry = (editingRank !== undefined && i === editingRank)
      ? { score: scores.length > i ? scores[i].score : 0, name: editingName ?? "" }
      : scores[i];

    const scoreStr = String(entry.score);
    const scoreFieldX = rankX + 4 * CHAR_W;
    const scoreFieldW = 6 * CHAR_W; // 6 chars wide
    const scoreX = scoreFieldX + scoreFieldW - scoreStr.length * CHAR_W;
    drawText(ctx, scoreStr, scoreX, y, bbcMicroColours.yellow);

    // Name
    const nameX = scoreFieldX + scoreFieldW + 2 * CHAR_W;
    if (editingRank !== undefined && i === editingRank) {
      // Show editing name with blinking cursor
      const displayName = editingName ?? "";
      drawText(ctx, displayName, nameX, y, bbcMicroColours.magenta);
      const cursorVisible = Math.floor(Date.now() / 300) % 2 === 0;
      if (cursorVisible && displayName.length < 9) {
        const cursorX = nameX + displayName.length * CHAR_W;
        ctx.fillStyle = bbcMicroColours.green;
        ctx.fillRect(cursorX, y, CHAR_W, 5);
      }
    } else {
      drawText(ctx, entry.name, nameX, y, bbcMicroColours.yellow);
    }
  }

  // Bottom prompt
  const bottomText = editingRank === undefined
    ? "PRESS SPACE BAR TO START"
    : "ENTER YOUR NAME";
  const bottomX = Math.floor((screenWidth - bottomText.length * CHAR_W) / 2);
  drawText(ctx, bottomText, bottomX, rowY(BOTTOM_ROW), bbcMicroColours.red);
}
