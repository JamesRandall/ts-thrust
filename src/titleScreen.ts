import {drawText, bbcMicroColours} from "./rendering";

export interface TitleScreenState {
  active: boolean;
  pageTimer: number;
  page: number;
}

const PAGE_FLIP_INTERVAL = 5;

interface TitleEntry {
  row: number;
  text: string;
  color: string;
  color2?: string;
}

const w = bbcMicroColours.white;

const titlePages: TitleEntry[][] = [
  [
    { row: 5, text: "THRUST", color: bbcMicroColours.green },
    { row: 8, text: "Rotate left: {A}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 9, text: "Rotate right: {D}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 10, text: "Thrust: {W}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 11, text: "Fire: {RETURN}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 12, text: "Shield / Tractor beam: {SPACE}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 13, text: "Cycle effects: [ ]", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },

    { row: 18, text: "Destroy the reactor to start", color: w },
    { row: 19, text: "the planet countdown", color: w },
    { row: 22, text: "PRESS ANY KEY TO START", color: w },
  ],
  [
    { row: 6, text: "THRUST", color: w },
    { row: 10, text: "A game of skill and gravity", color: w },
    { row: 14, text: "Collect the pod and escape", color: w },
    { row: 15, text: "each planet to complete", color: w },
    { row: 16, text: "your mission", color: w },
    { row: 20, text: "PRESS ANY KEY TO START", color: w },
  ]
];

export function createTitleScreen(): TitleScreenState {
  return { active: true, pageTimer: 0, page: 0 };
}

export function resetTitleScreen(state: TitleScreenState): void {
  state.active = true;
  state.pageTimer = 0;
  state.page = 0;
}

export function updateTitleScreen(state: TitleScreenState, dt: number): void {
  state.pageTimer += dt;
  if (state.pageTimer >= PAGE_FLIP_INTERVAL) {
    state.pageTimer -= PAGE_FLIP_INTERVAL;
    //state.page = state.page === 0 ? 1 : 0;
  }
}

export function renderTitleScreen(ctx: CanvasRenderingContext2D, state: TitleScreenState, screenWidth: number): void {
  const page = titlePages[state.page];
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
