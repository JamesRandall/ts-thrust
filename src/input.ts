/**
 * Input abstraction layer for Thrust.
 *
 * All game input flows through this module. In normal play the inputs
 * come from the real keyboard; in demo mode a scripted bitmask is
 * substituted transparently.
 *
 * Based on the original BBC Micro input system (test_inkey).
 */

// ---------------------------------------------------------------------------
// Input bit flags — each action maps to a single bit in a bitmask.
// Matches the original 6502 layout.
// ---------------------------------------------------------------------------

export const INPUT_ROTATE_LEFT    = 0x01;
export const INPUT_ROTATE_RIGHT   = 0x02;
export const INPUT_FIRE           = 0x04;
export const INPUT_THRUST         = 0x08;
export const INPUT_SHIELD_TRACTOR = 0x10;

// ---------------------------------------------------------------------------
// Structured game input — the common interface consumed by tick() and
// sound/rendering logic in main.ts.
// ---------------------------------------------------------------------------

export interface GameInput {
  rotateLeft: boolean;
  rotateRight: boolean;
  fire: boolean;
  thrust: boolean;
  shieldTractor: boolean;
}

// ---------------------------------------------------------------------------
// Key code → InputBit mapping (real keyboard)
// ---------------------------------------------------------------------------

export interface KeyBindings {
  thrust: string;
  rotateLeft: string;
  rotateRight: string;
  fire: string;
  shield: string;
}

const DEFAULT_BINDINGS: KeyBindings = {
  thrust:      "KeyW",
  rotateLeft:  "KeyA",
  rotateRight: "KeyD",
  fire:        "Enter",
  shield:      "Space",
};

const BINDINGS_STORAGE_KEY = "thrust-key-bindings";

function loadKeyBindings(): KeyBindings {
  try {
    const stored = localStorage.getItem(BINDINGS_STORAGE_KEY);
    if (stored) return { ...DEFAULT_BINDINGS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BINDINGS };
}

export function saveKeyBindings(): void {
  try {
    localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(keyBindings));
  } catch { /* ignore */ }
}

export const keyBindings: KeyBindings = loadKeyBindings();

/** Convert a KeyboardEvent.code to a short display name for the UI. */
export function keyDisplayName(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const names: Record<string, string> = {
    Space: "SPACE", Enter: "RETURN", ShiftLeft: "L SHIFT", ShiftRight: "R SHIFT",
    ControlLeft: "L CTRL", ControlRight: "R CTRL", AltLeft: "L ALT", AltRight: "R ALT",
    ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
    Backspace: "BACKSPACE", Tab: "TAB", CapsLock: "CAPS",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
    Minus: "-", Equal: "=", Backquote: "`",
  };
  return names[code] ?? code;
}

/** The ordered list of actions the remap screen walks through. */
export const remapActions: { key: keyof KeyBindings; label: string }[] = [
  { key: "thrust",      label: "Thrust" },
  { key: "rotateLeft",  label: "Rotate left" },
  { key: "rotateRight", label: "Rotate right" },
  { key: "fire",        label: "Fire" },
  { key: "shield",      label: "Shield / Tractor beam" },
];

/**
 * Build a GameInput from real keyboard state.
 * Death-gating is NOT applied here — that is the caller's responsibility.
 */
export function gameInputFromKeys(keys: Set<string>): GameInput {
  return {
    rotateLeft:    keys.has(keyBindings.rotateLeft),
    rotateRight:   keys.has(keyBindings.rotateRight),
    fire:          keys.has(keyBindings.fire),
    thrust:        keys.has(keyBindings.thrust),
    shieldTractor: keys.has(keyBindings.shield),
  };
}

/**
 * Build a GameInput from a demo-mode bitmask.
 */
export function gameInputFromDemoBitmask(bitmask: number): GameInput {
  return {
    rotateLeft:    (bitmask & INPUT_ROTATE_LEFT) !== 0,
    rotateRight:   (bitmask & INPUT_ROTATE_RIGHT) !== 0,
    fire:          (bitmask & INPUT_FIRE) !== 0,
    thrust:        (bitmask & INPUT_THRUST) !== 0,
    shieldTractor: (bitmask & INPUT_SHIELD_TRACTOR) !== 0,
  };
}
