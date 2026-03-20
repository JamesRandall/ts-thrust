import {drawText, bbcMicroColours} from "./rendering";
import {ScoreEntry, loadScores, renderScoreboard} from "./scoreboard";
import {keyBindings, keyDisplayName, remapActions, KeyBindings, saveKeyBindings} from "./input";

// Number of visible pages (instructions + scoreboard) before demo triggers
const TITLE_PAGE_COUNT = 2;
const PAGE_FLIP_INTERVAL = 5;

export interface KeyRemapState {
  active: boolean;
  step: number;           // index into remapActions
  pendingBindings: KeyBindings;  // bindings being built up
}

export interface TitleScreenState {
  active: boolean;
  pageTimer: number;
  page: number;
  scores: ScoreEntry[];
  /** Set to true when the scoreboard page times out — signals main.ts to start demo */
  demoRequested: boolean;
  remap: KeyRemapState | null;
}

interface TitleEntry {
  row: number;
  text: string;
  color: string;
  color2?: string;
}

function buildInstructionsPage(): TitleEntry[] {
  return [
    { row: 4, text: "THRUST", color: bbcMicroColours.green },
    { row: 6, text: `Thrust: {${keyDisplayName(keyBindings.thrust)}}`, color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 7, text: `Rotate left: {${keyDisplayName(keyBindings.rotateLeft)}}`, color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 8, text: `Rotate right: {${keyDisplayName(keyBindings.rotateRight)}}`, color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 9, text: `Fire: {${keyDisplayName(keyBindings.fire)}}`, color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 10, text: `Shield / Tractor beam: {${keyDisplayName(keyBindings.shield)}}`, color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 11, text: "Cycle CRT effects: {[ ]}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },

    { row: 13, text: "Original game copyright", color: bbcMicroColours.magenta },
    { row: 14, text: "{Jeremy C Smith} 1986", color: bbcMicroColours.magenta, color2: bbcMicroColours.yellow },
    { row: 16, text: "Recreated in Typescript by", color: bbcMicroColours.magenta },
    { row: 17, text: "{James Randall} in 2026", color: bbcMicroColours.magenta, color2: bbcMicroColours.yellow },
    { row: 18, text: "https://jamesdrandall.com/", color: bbcMicroColours.yellow },

    { row: 20, text: "PRESS {K} TO REDEFINE KEYS", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 21, text: "PRESS {SPACE} TO START", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
  ];
}

export function createTitleScreen(): TitleScreenState {
  return { active: true, pageTimer: 0, page: 0, scores: loadScores(), demoRequested: false, remap: null };
}

export function resetTitleScreen(state: TitleScreenState): void {
  state.active = true;
  state.pageTimer = 0;
  state.page = 0;
  state.scores = loadScores();
  state.demoRequested = false;
  state.remap = null;
}

/**
 * Update the title screen timer. Cycles: instructions → scoreboard → demo request.
 * When the scoreboard page times out, demoRequested is set to true and the
 * title screen deactivates itself so main.ts can start the demo.
 */
export function updateTitleScreen(state: TitleScreenState, dt: number): void {
  if (state.remap) return;  // Freeze page timer during key remap
  state.pageTimer += dt;
  if (state.pageTimer >= PAGE_FLIP_INTERVAL) {
    state.pageTimer -= PAGE_FLIP_INTERVAL;
    const nextPage = state.page + 1;
    if (nextPage >= TITLE_PAGE_COUNT) {
      // Scoreboard has timed out — signal main.ts to start demo
      state.demoRequested = true;
    } else {
      state.page = nextPage;
    }
  }
}

export function startKeyRemap(state: TitleScreenState): void {
  state.remap = {
    active: true,
    step: 0,
    pendingBindings: { ...keyBindings },
  };
}

const BLOCKED_REMAP_KEYS = new Set(["BracketLeft", "BracketRight"]);

export function handleRemapKey(state: TitleScreenState, code: string): boolean {
  if (!state.remap) return false;
  // Block [ and ] (used for CRT effects)
  if (BLOCKED_REMAP_KEYS.has(code)) return false;
  // Block keys already assigned in this remap session
  const alreadyUsed = remapActions.slice(0, state.remap.step)
    .some(a => state.remap!.pendingBindings[a.key] === code);
  if (alreadyUsed) return false;
  const action = remapActions[state.remap.step];
  state.remap.pendingBindings[action.key] = code;
  state.remap.step++;
  if (state.remap.step >= remapActions.length) {
    // Apply all bindings and persist
    Object.assign(keyBindings, state.remap.pendingBindings);
    saveKeyBindings();
    state.remap = null;
    state.pageTimer = 0;
  }
  return true;
}

function renderRemapScreen(ctx: CanvasRenderingContext2D, state: KeyRemapState, screenWidth: number): void {
  const titleText = "REDEFINE KEYS";
  const titleX = Math.floor((screenWidth - titleText.length * 8) / 2);
  drawText(ctx, titleText, titleX, 4 * 8, bbcMicroColours.green);

  // Show already-assigned keys
  for (let i = 0; i < state.step; i++) {
    const action = remapActions[i];
    const name = keyDisplayName(state.pendingBindings[action.key]);
    const text = `${action.label}: ${name}`;
    const x = Math.floor((screenWidth - text.length * 8) / 2);
    drawText(ctx, text, x, (6 + i) * 8, bbcMicroColours.yellow);
  }

  // Show current prompt
  if (state.step < remapActions.length) {
    const action = remapActions[state.step];
    const promptText = `${action.label}?`;
    const px = Math.floor((screenWidth - promptText.length * 8) / 2);
    drawText(ctx, promptText, px, (6 + state.step) * 8, bbcMicroColours.red);
  }
}

export function renderTitleScreen(ctx: CanvasRenderingContext2D, state: TitleScreenState, screenWidth: number): void {
  if (state.remap) {
    renderRemapScreen(ctx, state.remap, screenWidth);
    return;
  }
  if (state.page === 1) {
    renderScoreboard(ctx, screenWidth, state.scores);
    return;
  }
  const page = buildInstructionsPage();
  for (const entry of page) {
    const y = entry.row * 8;
    if (!entry.color2) {
      const x = Math.floor((screenWidth - entry.text.length * 8) / 2);
      drawText(ctx, entry.text, x, y, entry.color);
    } else {
      // Parse segments: text outside {} uses color, text inside {} uses color2
      const segments: { text: string; color: string }[] = [];
      let displayLen = 0;
      let remaining = entry.text;
      while (remaining.length > 0) {
        const open = remaining.indexOf('{');
        if (open === -1) {
          segments.push({ text: remaining, color: entry.color });
          displayLen += remaining.length;
          break;
        }
        if (open > 0) {
          segments.push({ text: remaining.substring(0, open), color: entry.color });
          displayLen += open;
        }
        const close = remaining.indexOf('}', open);
        const inner = remaining.substring(open + 1, close);
        segments.push({ text: inner, color: entry.color2 });
        displayLen += inner.length;
        remaining = remaining.substring(close + 1);
      }
      let x = Math.floor((screenWidth - displayLen * 8) / 2);
      for (const seg of segments) {
        drawText(ctx, seg.text, x, y, seg.color);
        x += seg.text.length * 8;
      }
    }
  }
}
