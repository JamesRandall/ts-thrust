#!/usr/bin/env npx tsx

import * as fs from "fs";

/**
 * Thrust Level Decoder
 *
 * Decodes the 6502 assembly level data from BBC Micro Thrust into TypeScript
 * level definitions. The terrain is stored as run-length encoded wall profiles
 * (left wall and right wall), with a count table and an x-increment table for
 * each wall. Objects are stored as parallel arrays of X, Y (INT+EXT), type,
 * and gun params.
 *
 * Terrain encoding:
 *   Table A/C = counts (how many rows at this increment)
 *   Table B/D = x increments (signed, added to accumulated x each row)
 *   Left wall starts at x=0, right wall starts at x=0xFF (255)
 *   Initial zero-increment segments are sky above the world.
 *
 * Display coordinate mapping:
 *   display_y = raw_row - 256
 */

// ============================================================================
// Types
// ============================================================================

type Polygon = Array<number>;
type ObjectPosition = { x: number; y: number };
type TurretDirection = 'up_left' | 'up_right' | 'down_left' | 'down_right';
type TurretPosition = ObjectPosition & { direction: TurretDirection; gunParam: number };
type SwitchDirection = 'left' | 'right';
type SwitchPosition = ObjectPosition & { direction: SwitchDirection };
type DoorType = 'slide' | 'step' | 'chevron';
type DoorConfig = {
    type: DoorType;
    worldY: number;
    threshold: number;
    scanlines: number;
    closedX: number;
    openX: number;
    innerX: number;
};

/**
 * A spawn/respawn point. Levels with vertical depth have multiple checkpoints
 * ordered top-to-bottom by Y. On death the game picks the nearest checkpoint
 * at or above the ship's current Y position. The first entry (index 0) is
 * always used for a fresh level start.
 *
 * Fields decoded from level_reset_data:
 *   midpointX/Y  - ship midpoint position (Y is 16-bit: yHigh*256 + yInt)
 *   windowX/Y    - initial scroll window position (Y is 16-bit: yExt*256 + yInt)
 */
type SpawnPoint = {
    midpointX: number;
    midpointY: number;
    windowX: number;
    windowY: number;
};

type Level = {
    name: string;
    terrainColor: string;
    objectColor: string;
    spawnPoints: SpawnPoint[];
    polygons: Polygon[];
    turrets: TurretPosition[];
    powerPlant: ObjectPosition;
    podPedestal: ObjectPosition;
    fuel: ObjectPosition[];
    switches: SwitchPosition[];
    doorConfig: DoorConfig | null;
};

// ============================================================================
// BBC Micro Mode 1 physical colours
// ============================================================================

const bbcMicroColours: Record<number, string> = {
    0: "black", 1: "red", 2: "green", 3: "yellow",
    4: "blue", 5: "magenta", 6: "cyan", 7: "white",
};

// ============================================================================
// Object type constants
// ============================================================================

const OBJECT_FUEL = 0x4;
const OBJECT_POD_STAND = 0x5;
const OBJECT_GENERATOR = 0x6;
const OBJECT_DOOR_SWITCH_RIGHT = 0x07;
const OBJECT_DOOR_SWITCH_LEFT = 0x08;

function isGunType(type: number): boolean {
    return type >= 0x0 && type <= 0x3;
}

// ============================================================================
// Raw level data extracted from the 6502 source
// ============================================================================

const terrainData = [
    {
        A: [0xff,0xff,0xab,0x01,0x0f,0x01,0x0c,0x01,0xff],
        B: [0x00,0x00,0x00,0x55,0x01,0x15,0x01,0x19,0x00],
        C: [0xff,0xff,0xab,0x01,0x09,0x01,0xff],
        D: [0x00,0x00,0x00,0xb7,0xff,0xf1,0x00],
    },
    {
        A: [0xff,0xff,0xaf,0x01,0x0b,0x01,0x17,0x36,0x17,0x14,0x0f,0x01,0xff],
        B: [0x00,0x00,0x00,0x4a,0x01,0x19,0x01,0x00,0xff,0x00,0x01,0x14,0x00],
        C: [0xff,0xff,0xaf,0x01,0x1b,0x3a,0x11,0x15,0x18,0xff],
        D: [0x00,0x00,0x00,0xb4,0xff,0x00,0x01,0x00,0xff,0x00],
    },
    {
        A: [0xff,0xff,0xb9,0x01,0x50,0x0a,0x32,0x01,0x0a,0x1e,0x01,0x0a,0x55,0x0a,0x01,0xff],
        B: [0x00,0x00,0x00,0x87,0x00,0xff,0x00,0xe2,0xff,0x00,0xf1,0xff,0x00,0x01,0x15,0x00],
        C: [0xff,0xff,0xb9,0x01,0x13,0x01,0x3c,0x01,0x14,0x0a,0x01,0x3c,0x01,0x32,0x01,0x09,0xff],
        D: [0x00,0x00,0x00,0xb4,0x00,0xe9,0x00,0x18,0x00,0xff,0xec,0x00,0xe2,0x00,0xec,0xff,0x00],
    },
    {
        A: [0xff,0xff,0xa0,0x01,0x13,0x01,0x15,0x26,0x14,0x0a,0x06,0x14,0x22,0x01,0x14,0x01,0x26,0x1c,0x24,0x0a,0xff,0xff],
        B: [0x00,0x00,0x00,0x5a,0x01,0x11,0x00,0xff,0x00,0x01,0x00,0xff,0x00,0x19,0x01,0x21,0x00,0xff,0x00,0x01,0x00,0x00],
        C: [0xff,0xff,0xa0,0x01,0x67,0x01,0x12,0x18,0x01,0x84,0x18,0x14,0x01,0xff,0xff],
        D: [0x00,0x00,0x00,0x8d,0x00,0xe2,0x00,0x01,0x28,0x00,0xff,0x00,0xf4,0x00,0x00],
    },
    {
        A: [0xff,0xff,0xa5,0x01,0x15,0x16,0x01,0x38,0x01,0x0c,0x1c,0x01,0x28,0x14,0x01,0x56,0x14,0x0e,0x01,0x1c,0x0c,0x01,0x1e,0x0c,0x01,0x52,0x08,0x01,0xff],
        B: [0x00,0x00,0x00,0x58,0x01,0x00,0x17,0x00,0xf6,0xff,0x00,0x0a,0x00,0xff,0xec,0x00,0x01,0x00,0xf6,0x00,0x01,0x12,0x00,0x01,0x14,0x00,0x01,0x0a,0x00],
        C: [0xff,0xff,0xa5,0x01,0x64,0x01,0x0a,0x1e,0x01,0x28,0x01,0x28,0x0a,0x01,0x22,0x20,0x2c,0x01,0x0a,0x16,0x01,0x3e,0x10,0x1e,0x0c,0xff],
        D: [0x00,0x00,0x00,0x93,0x00,0x0e,0x01,0x00,0xdc,0x00,0x08,0x00,0xff,0xde,0x00,0x01,0x00,0x0a,0x01,0x00,0x10,0x00,0x01,0x00,0xff,0x00],
    },
    {
        A: [0xff,0xff,0x7f,0x01,0x3e,0x01,0x50,0x28,0x01,0x0a,0xa2,0x01,0x36,0x0d,0x14,0x36,0x0e,0x0d,0x1f,0x0a,0x39,0x01,0xff],
        B: [0x00,0x00,0x00,0x4d,0x00,0x17,0x01,0x00,0xec,0xff,0x00,0xef,0x00,0xff,0x00,0x01,0x00,0xff,0x00,0xff,0x00,0x0b,0x00],
        C: [0xff,0xff,0x7f,0x01,0x2b,0x14,0x37,0x41,0x14,0x14,0x01,0x1c,0x22,0x12,0x14,0x0a,0x32,0x01,0x27,0x2c,0x1e,0x07,0x07,0x38,0x1c,0x23,0x01,0x16,0x01,0xff],
        D: [0x00,0x00,0x00,0xb7,0xff,0x00,0x01,0x00,0x01,0x00,0xe7,0xff,0x00,0x01,0x00,0xff,0x00,0xeb,0x00,0x01,0x00,0x01,0xff,0x00,0xff,0x00,0x0d,0x00,0xf1,0x00],
    },
];

const objectData = [
    {
        posX:  [0x8f,0xa0,0x6e,0x7d],
        posY:  [0xbd,0xab,0xb3,0xbb],
        posYE: [0x01,0x01,0x01,0x01],
        types: [0x05,0x06,0x04,0x00,0xff],
        gunParams: [0x00,0x00,0x00,0x1e],
    },
    {
        posX:  [0x7f,0x64,0x8b,0x74,0x9e],
        posY:  [0x38,0xb1,0x3b,0x14,0x0a],
        posYE: [0x02,0x01,0x02,0x02,0x02],
        types: [0x05,0x06,0x04,0x01,0x03,0xff],
        gunParams: [0x00,0x00,0x00,0x06,0x0f],
    },
    {
        posX:  [0x4e,0xa4,0x78,0x97,0x9d,0xa3,0x7d,0x67,0x5d,0x3e,0x58,0xab,0x81],
        posY:  [0xce,0xc3,0xb1,0x21,0x21,0x21,0x5e,0x91,0x97,0x72,0x48,0x1e,0x0a],
        posYE: [0x02,0x01,0x01,0x02,0x02,0x02,0x02,0x02,0x02,0x02,0x02,0x02,0x02],
        types: [0x05,0x06,0x04,0x04,0x04,0x04,0x04,0x04,0x02,0x01,0x01,0x02,0x01,0xff],
        gunParams: [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x1b,0x06,0x0a,0x16,0x04],
    },
    {
        posX:  [0x8e,0x5b,0xac,0xac,0x92,0x72,0x5a,0x5a,0x78,0x6d,0x8a,0xa2],
        posY:  [0xd9,0x40,0x51,0x87,0x57,0xd0,0x01,0x16,0x24,0x4c,0x92,0xba],
        posYE: [0x02,0x02,0x02,0x02,0x02,0x01,0x02,0x02,0x02,0x02,0x02,0x02],
        types: [0x05,0x06,0x08,0x08,0x04,0x01,0x00,0x01,0x03,0x00,0x01,0x02,0xff],
        gunParams: [0x00,0x00,0x00,0x00,0x00,0x06,0x06,0x06,0x12,0x1f,0x06,0x1e],
    },
    {
        posX:  [0xa2,0x8f,0xa4,0x98,0x7c,0x9a,0xa0,0x68,0x69,0x6f,0x89,0x8f,0x72,0xa2,0x86,0x5d,0x8e,0x7b,0xac],
        posY:  [0x8d,0x29,0x25,0x75,0xc9,0x2b,0x2b,0x87,0x0a,0x0a,0x35,0x35,0x0d,0x0c,0x83,0x04,0x00,0x2f,0x63],
        posYE: [0x03,0x02,0x03,0x03,0x01,0x02,0x02,0x02,0x03,0x03,0x03,0x03,0x02,0x02,0x02,0x03,0x03,0x03,0x03],
        types: [0x05,0x06,0x08,0x07,0x04,0x04,0x04,0x04,0x04,0x04,0x04,0x04,0x01,0x03,0x02,0x00,0x03,0x00,0x03,0xff],
        gunParams: [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x05,0x14,0x1a,0x02,0x12,0x1e,0x19],
    },
    {
        posX:  [0x9a,0xa9,0xa1,0xbe,0x9a,0xc1,0xaf,0x9b,0xa2,0x9b,0x7b,0xac,0xac,0xac,0xca,0x99,0x99],
        posY:  [0xe4,0x04,0x98,0x5d,0xf8,0x57,0xbf,0xac,0x86,0x2e,0x1f,0xc1,0xa8,0x67,0x3e,0x39,0xcc],
        posYE: [0x03,0x04,0x03,0x03,0x02,0x02,0x03,0x03,0x03,0x03,0x03,0x02,0x02,0x02,0x02,0x02,0x01],
        types: [0x05,0x06,0x07,0x08,0x04,0x04,0x02,0x01,0x01,0x03,0x01,0x02,0x03,0x02,0x03,0x01,0x03,0xff],
        gunParams: [0x00,0x00,0x00,0x00,0x00,0x00,0x1a,0x06,0x09,0x12,0x06,0x16,0x12,0x1b,0x12,0x05,0x0e],
    },
];

const levelResetData = [
    { size: 1, data: [0x01,0x91,0x56,0x01,0x24,0x6c] },
    { size: 1, data: [0x01,0x91,0x56,0x01,0x24,0x6c] },
    { size: 3, data: [0x01,0x02,0x02, 0x91,0x2d,0x96, 0x56,0x6f,0x32, 0x01,0x01,0x02, 0x24,0xaa,0x23, 0x6c,0x86,0x48] },
    { size: 3, data: [0x01,0x01,0x02, 0x91,0xe6,0x4a, 0x56,0x57,0x76, 0x01,0x01,0x01, 0x24,0x60,0xd8, 0x6c,0x7b,0xa1] },
    { size: 4, data: [0x01,0x02,0x02,0x03, 0x91,0x68,0xdc,0x15, 0x56,0x58,0x43,0x64, 0x01,0x01,0x02,0x02, 0x24,0xee,0x66,0x9f, 0x6c,0x7b,0x6b,0x81] },
    { size: 5, data: [0x01,0x02,0x02,0x03,0x03, 0x91,0x4b,0xd4,0x2a,0x98, 0x56,0x8c,0x82,0x6e,0x87, 0x01,0x01,0x02,0x02,0x03, 0x24,0xd8,0x5a,0xb4,0x1b, 0x6c,0xa2,0x9a,0x87,0xae] },
];

const levelLandscapeColour = [0x01, 0x02, 0x06, 0x02, 0x01, 0x05];
const levelObjectColour = [0x02, 0x01, 0x02, 0x05, 0x05, 0x06];

const gunTypeToDirection: Record<number, TurretDirection> = {
    0x00: 'up_right',
    0x01: 'down_right',
    0x02: 'up_left',
    0x03: 'down_left',
};

// ============================================================================
// Terrain decoder - simplified polygon vertices
// ============================================================================

function toSigned(byte: number): number {
    return byte > 127 ? byte - 256 : byte;
}

/**
 * Generate simplified polygon vertices for a wall.
 *
 * Processes the RLE terrain data and emits a vertex at each segment boundary
 * (where the x-increment changes). This produces clean diagonal lines between
 * vertices, matching the original game's visual appearance.
 *
 * For level 0 left wall, this produces:
 *   0,425 -> 85,425 -> 100,440 -> 121,441 -> 133,453 -> 158,454
 */
function generateWallPolygon(
    countTable: number[],
    incrementTable: number[],
    startX: number,
    isLeftWall: boolean,
    yOffset: number,
    bottomY: number,
): Polygon {
    const polygon: number[] = [];
    const edgeX = isLeftWall ? 0 : 256;

    let x = startX;
    let row = 0;

    // Process segments, collecting vertices at boundaries
    const vertices: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < countTable.length; i++) {
        const count = countTable[i];
        const inc = incrementTable[i];

        // Terminal sentinel: 0xFF with inc=0 AFTER the initial sky segments
        if (count === 0xff && inc === 0 && i > 1) break;

        // Skip initial sky segments (flat at starting x)
        if (inc === 0 && x === startX && vertices.length === 0) {
            row += count;
            continue;
        }

        // Advance through the segment using 8-bit wrapping (matches 6502 byte arithmetic)
        x = (x + count * inc) & 0xFF;
        row += count;
        const endY = (row - 1) - yOffset;

        // Emit the endpoint vertex for this segment
        vertices.push({ x, y: endY });
    }

    if (vertices.length === 0) return [];

    // Build closed polygon
    polygon.push(edgeX, vertices[0].y);
    for (const v of vertices) {
        polygon.push(v.x, v.y);
    }
    polygon.push(vertices[vertices.length - 1].x, bottomY);
    polygon.push(edgeX, bottomY);

    return polygon;
}

/**
 * Calculate the total terrain depth (in display coordinates) for bottom-closing.
 */
function calculateTerrainDepth(countTable: number[], yOffset: number): number {
    let totalRows = 0;
    for (let i = 0; i < countTable.length; i++) {
        totalRows += countTable[i];
    }
    return totalRows - yOffset;
}

// ============================================================================
// Object & starting position decoders
// ============================================================================

/**
 * Decode all spawn/respawn points for a level from the reset data.
 *
 * The reset data is stored as 6 parallel arrays (stripes) of `size` entries:
 *   stripe 0: midpoint_ypos_INT_HI  (Y high byte)
 *   stripe 1: midpoint_ypos_INT     (Y low byte)
 *   stripe 2: window_xpos_INT
 *   stripe 3: window_ypos_EXT       (window Y high byte)
 *   stripe 4: window_ypos_INT       (window Y low byte)
 *   stripe 5: midpoint_xpos_INT
 *
 * Points are ordered top-to-bottom by Y. On death the 6502 code walks
 * through them doing a 16-bit comparison (yHigh:yInt >= shipYHigh:shipYInt)
 * to find the nearest checkpoint at or above the ship's current depth.
 */
function getSpawnPoints(levelIndex: number): SpawnPoint[] {
    const r = levelResetData[levelIndex];
    const s = r.size;
    const points: SpawnPoint[] = [];

    for (let i = 0; i < s; i++) {
        points.push({
            midpointX: r.data[s * 5 + i] + 4,
            midpointY: r.data[s * 0 + i] * 256 + r.data[s * 1 + i],
            windowX:   r.data[s * 2 + i],
            windowY:   r.data[s * 3 + i] * 256 + r.data[s * 4 + i],
        });
    }

    return points;
}

function decodeObjects(levelIndex: number) {
    const obj = objectData[levelIndex];
    const turrets: TurretPosition[] = [];
    const fuel: ObjectPosition[] = [];
    const switches: SwitchPosition[] = [];
    let powerPlant: ObjectPosition = { x: 0, y: 0 };
    let podPedestal: ObjectPosition = { x: 0, y: 0 };

    const numObjects = obj.types.indexOf(0xff);
    for (let i = 0; i < numObjects; i++) {
        const type = obj.types[i];
        const pos: ObjectPosition = { x: obj.posX[i], y: obj.posYE[i] * 256 + obj.posY[i] };

        if (isGunType(type)) turrets.push({ ...pos, direction: gunTypeToDirection[type], gunParam: obj.gunParams[i] });
        else if (type === OBJECT_FUEL) fuel.push(pos);
        else if (type === OBJECT_POD_STAND) podPedestal = pos;
        else if (type === OBJECT_GENERATOR) powerPlant = pos;
        else if (type === OBJECT_DOOR_SWITCH_LEFT) switches.push({ ...pos, direction: 'left' });
        else if (type === OBJECT_DOOR_SWITCH_RIGHT) switches.push({ ...pos, direction: 'right' });
    }

    return { turrets, powerPlant, podPedestal, fuel, switches };
}

// ============================================================================
// Main decoder
// ============================================================================

const doorConfigs: Record<number, DoorConfig> = {
    3: { type: 'slide', worldY: 617, threshold: 16, scanlines: 13, closedX: 174, openX: 158, innerX: 156 },
    4: { type: 'step', worldY: 835, threshold: 21, scanlines: 21, closedX: 166, openX: 152, innerX: 152 },
    5: { type: 'chevron', worldY: 880, threshold: 18, scanlines: 15, closedX: 192, openX: 174, innerX: 174 },
};

function decodeLevels(): Level[] {
    const levels: Level[] = [];
    const Y_OFFSET = 256;

    for (let i = 0; i < 6; i++) {
        const td = terrainData[i];

        // Calculate bottom Y: last terrain vertex + generous padding for solid fill below
        const leftDepth = calculateTerrainDepth(td.A, Y_OFFSET);
        const rightDepth = calculateTerrainDepth(td.C, Y_OFFSET);
        // Approximate the last meaningful terrain vertex row
        // (total rows minus the final terminal 0xFF segment = 255)
        const approxLastVertex = Math.max(leftDepth, rightDepth) - 255;
        const bottomY = Math.round((approxLastVertex + 150) / 50) * 50;

        const leftPolygon = generateWallPolygon(td.A, td.B, 0, true, Y_OFFSET, bottomY);
        const rightPolygon = generateWallPolygon(td.C, td.D, 0xff, false, Y_OFFSET, bottomY);

        const polygons: Polygon[] = [];
        if (leftPolygon.length > 0) polygons.push(leftPolygon);
        if (rightPolygon.length > 0) polygons.push(rightPolygon);

        const objects = decodeObjects(i);
        const spawnPoints = getSpawnPoints(i);
        const terrainColor = bbcMicroColours[levelLandscapeColour[i]] ?? "white";
        const objectColor = bbcMicroColours[levelObjectColour[i]] ?? "white";

        levels.push({
            name: `Level ${i}`,
            terrainColor,
            objectColor,
            spawnPoints,
            polygons,
            turrets: objects.turrets,
            powerPlant: objects.powerPlant,
            podPedestal: objects.podPedestal,
            fuel: objects.fuel,
            switches: objects.switches,
            doorConfig: doorConfigs[i] ?? null,
        });
    }

    return levels;
}

// ============================================================================
// Output generation
// ============================================================================

function formatPosition(pos: ObjectPosition): string {
    return `{ x: ${pos.x}, y: ${pos.y} }`;
}

function formatPolygon(polygon: Polygon, indent: string): string {
    const pairs: string[] = [];
    for (let i = 0; i < polygon.length; i += 2) {
        pairs.push(`${polygon[i]},${polygon[i + 1]}`);
    }
    const pairsPerLine = 4;
    const lines: string[] = [];
    for (let i = 0; i < pairs.length; i += pairsPerLine) {
        lines.push(pairs.slice(i, i + pairsPerLine).join(", "));
    }
    return `[\n${lines.map(l => `${indent}    ${l}`).join(",\n")}\n${indent}]`;
}

function generateOutput(levels: Level[]): string {
    const lines: string[] = [];

    lines.push(`// Auto-generated from Thrust 6502 assembly source`);
    lines.push(`// Decoded by decode-levels.ts`);
    lines.push(``);
    lines.push(`export type Polygon = Array<number>;`);
    lines.push(`export type ObjectPosition = { x: number, y: number};`);
    lines.push(`export type TurretDirection = 'up_left' | 'up_right' | 'down_left' | 'down_right';`);
    lines.push(`export type TurretPosition = ObjectPosition & { direction: TurretDirection; gunParam: number };`);
    lines.push(`export type SwitchDirection = 'left' | 'right';`);
    lines.push(`export type SwitchPosition = ObjectPosition & { direction: SwitchDirection };`);
    lines.push(`export type DoorType = 'slide' | 'step' | 'chevron';`);
    lines.push(`export type DoorConfig = {`);
    lines.push(`    type: DoorType;`);
    lines.push(`    worldY: number;`);
    lines.push(`    threshold: number;`);
    lines.push(`    scanlines: number;`);
    lines.push(`    closedX: number;`);
    lines.push(`    openX: number;`);
    lines.push(`    innerX: number;`);
    lines.push(`};`);
    lines.push(``);
    lines.push(`export type SpawnPoint = {`);
    lines.push(`    midpointX: number;`);
    lines.push(`    midpointY: number;`);
    lines.push(`    windowX: number;`);
    lines.push(`    windowY: number;`);
    lines.push(`};`);
    lines.push(``);
    lines.push(`export type Level = {`);
    lines.push(`    name: string;`);
    lines.push(`    terrainColor: string;`);
    lines.push(`    objectColor: string;`);
    lines.push(`    spawnPoints: SpawnPoint[];`);
    lines.push(`    polygons: Polygon[];`);
    lines.push(`    turrets: TurretPosition[];`);
    lines.push(`    powerPlant: ObjectPosition;`);
    lines.push(`    podPedestal: ObjectPosition;`);
    lines.push(`    fuel: ObjectPosition[];`);
    lines.push(`    switches: SwitchPosition[];`);
    lines.push(`    doorConfig: DoorConfig | null;`);
    lines.push(`};`);
    lines.push(``);
    lines.push(`export const bbcMicroColours = {`);
    lines.push(`    black: "black",`);
    lines.push(`    red: "red",`);
    lines.push(`    green: "green",`);
    lines.push(`    yellow: "yellow",`);
    lines.push(`    blue: "blue",`);
    lines.push(`    magenta: "magenta",`);
    lines.push(`    cyan: "cyan",`);
    lines.push(`    white: "white",`);
    lines.push(`};`);
    lines.push(``);
    lines.push(`export const levels: Level[] = [`);

    for (const level of levels) {
        lines.push(`    {`);
        lines.push(`        name: "${level.name}",`);
        lines.push(`        terrainColor: bbcMicroColours.${level.terrainColor},`);
        lines.push(`        objectColor: bbcMicroColours.${level.objectColor},`);
        lines.push(`        spawnPoints: [`);
        for (let sp = 0; sp < level.spawnPoints.length; sp++) {
            const p = level.spawnPoints[sp];
            const label = sp === 0 ? " // initial spawn" : ` // checkpoint ${sp}`;
            lines.push(`            { midpointX: ${p.midpointX}, midpointY: ${p.midpointY}, windowX: ${p.windowX}, windowY: ${p.windowY} },${label}`);
        }
        lines.push(`        ],`);
        lines.push(`        polygons: [`);
        for (let p = 0; p < level.polygons.length; p++) {
            const label = p === 0 ? "Left terrain wall" : "Right terrain wall";
            lines.push(`            // ${label}`);
            lines.push(`            ${formatPolygon(level.polygons[p], "            ")},`);
        }
        lines.push(`        ],`);
        lines.push(`        turrets: [${level.turrets.map(t => `\n            { x: ${t.x}, y: ${t.y}, direction: '${t.direction}', gunParam: 0x${t.gunParam.toString(16).padStart(2, '0')} }`).join(",")}${level.turrets.length > 0 ? ",\n        " : ""}],`);
        lines.push(`        powerPlant: ${formatPosition(level.powerPlant)},`);
        lines.push(`        podPedestal: ${formatPosition(level.podPedestal)},`);
        lines.push(`        fuel: [${level.fuel.map(f => `\n            ${formatPosition(f)}`).join(",")}${level.fuel.length > 0 ? ",\n        " : ""}],`);
        lines.push(`        switches: [${level.switches.map(s => `\n            { x: ${s.x}, y: ${s.y}, direction: '${s.direction}' }`).join(",")}${level.switches.length > 0 ? ",\n        " : ""}],`);
        if (level.doorConfig) {
            const dc = level.doorConfig;
            lines.push(`        doorConfig: { type: '${dc.type}', worldY: ${dc.worldY}, threshold: ${dc.threshold}, scanlines: ${dc.scanlines}, closedX: ${dc.closedX}, openX: ${dc.openX}, innerX: ${dc.innerX} },`);
        } else {
            lines.push(`        doorConfig: null,`);
        }
        lines.push(`    },`);
    }

    lines.push(`];`);
    lines.push(``);

    return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

const levels = decodeLevels();
const output = generateOutput(levels);

const outputPath = "levels.ts";
fs.writeFileSync(outputPath, output);
console.log(`Written ${outputPath} with ${levels.length} levels`);

for (const level of levels) {
    console.log(
        `  ${level.name}: color=${level.terrainColor}, spawns=${level.spawnPoints.length}, ` +
        `start=(${level.spawnPoints[0].midpointX},${level.spawnPoints[0].midpointY}), ` +
        `polygons=${level.polygons.length}, turrets=${level.turrets.length}, fuel=${level.fuel.length}`
    );
}
