import { DoorConfig } from "./levels";
import { Point, WORLD_SCALE_X, WORLD_SCALE_Y } from "./rendering";

const DOOR_TIMER_INITIAL = 0xFF;

export interface DoorState {
    counterA: number;
    counterB: number;
}

export function createDoorState(): DoorState {
    return { counterA: 0, counterB: 0 };
}

export function triggerDoor(state: DoorState): void {
    state.counterA = DOOR_TIMER_INITIAL;
}

export function tickDoor(state: DoorState, config: DoorConfig | null): void {
    if (!config) return;
    if (state.counterA > 0) {
        state.counterA--;
    }
    if (state.counterA < config.threshold) {
        state.counterB = state.counterA;
    } else if (state.counterB < config.threshold) {
        state.counterB++;
    }
}

export function getDoorPolygon(state: DoorState, config: DoorConfig | null, camX: number, camY: number): Point[] | null {
    if (!config) return null;

    switch (config.type) {
        case 'slide': return getSlidePolygon(state.counterB, config, camX, camY);
        case 'step': return getStepPolygon(state.counterB, config, camX, camY);
        case 'chevron': return getChevronPolygon(state.counterB, config, camX, camY);
    }
}

function getSlidePolygon(counterB: number, config: DoorConfig, camX: number, camY: number): Point[] | null {
    const doorX = config.closedX - counterB;
    if (doorX <= config.innerX) return null;

    const left = config.innerX * WORLD_SCALE_X - camX;
    const right = doorX * WORLD_SCALE_X - camX;
    const top = config.worldY * WORLD_SCALE_Y - camY;
    const bottom = (config.worldY + config.scanlines) * WORLD_SCALE_Y - camY;

    return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
    ];
}

function getStepPolygon(counterB: number, config: DoorConfig, camX: number, camY: number): Point[] | null {
    if (counterB >= config.threshold) return null;

    // Top counterB scanlines are open (at innerX), bottom (scanlines-counterB) are closed
    const closedStartY = config.worldY + counterB;
    const closedEndY = config.worldY + config.scanlines;

    const left = config.innerX * WORLD_SCALE_X - camX;
    const right = config.closedX * WORLD_SCALE_X - camX;
    const top = closedStartY * WORLD_SCALE_Y - camY;
    const bottom = closedEndY * WORLD_SCALE_Y - camY;

    return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
    ];
}

function getChevronPolygon(counterB: number, config: DoorConfig, camX: number, camY: number): Point[] | null {
    const baseX = config.closedX - counterB;
    // If peak of chevron (baseX + 6) is at or behind inner wall, no visible door
    if (baseX + 6 <= config.innerX) return null;

    const innerSX = config.innerX * WORLD_SCALE_X - camX;
    const points: Point[] = [];

    // Top-left corner
    points.push({ x: innerSX, y: config.worldY * WORLD_SCALE_Y - camY });

    // Right side: chevron outline from top to bottom
    // First 7 scanlines: X increments by 1 per row
    let x = baseX;
    for (let i = 0; i < 7; i++) {
        const effectiveX = Math.max(x, config.innerX);
        points.push({ x: effectiveX * WORLD_SCALE_X - camX, y: (config.worldY + i) * WORLD_SCALE_Y - camY });
        x++;
    }
    // Next 8 scanlines: X decrements by 1 per row
    for (let i = 0; i < 8; i++) {
        const effectiveX = Math.max(x, config.innerX);
        points.push({ x: effectiveX * WORLD_SCALE_X - camX, y: (config.worldY + 7 + i) * WORLD_SCALE_Y - camY });
        x--;
    }

    // Bottom-left corner
    points.push({ x: innerSX, y: (config.worldY + config.scanlines) * WORLD_SCALE_Y - camY });

    return points;
}
