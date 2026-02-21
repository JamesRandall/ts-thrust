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
    { row: 4, text: "THRUST", color: bbcMicroColours.green },
    { row: 6, text: "Thrust: {W}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 7, text: "Rotate left: {A}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 8, text: "Rotate right: {D}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 9, text: "Fire: {RETURN}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 10, text: "Shield / Tractor beam: {SPACE}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },
    { row: 11, text: "Cycle CRT effects: {[ ]}", color: bbcMicroColours.red, color2: bbcMicroColours.yellow },

    { row: 13, text: "Original game copyright", color: bbcMicroColours.magenta },
    { row: 14, text: "{Jeremy C Smith} 1986", color: bbcMicroColours.magenta, color2: bbcMicroColours.yellow },
    { row: 16, text: "Recreated in Typescript by", color: bbcMicroColours.magenta },
    { row: 17, text: "{James Randall} in 2026", color: bbcMicroColours.magenta, color2: bbcMicroColours.yellow },
    { row: 18, text: "https://jamesdrandall.com/", color: bbcMicroColours.yellow },

    { row: 21, text: "PRESS ANY KEY TO START", color: bbcMicroColours.red },
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
