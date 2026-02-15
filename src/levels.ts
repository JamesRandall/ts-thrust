import {bbcMicroColours} from "./rendering";

export type Polygon = Array<number>;
export type ObjectPosition = { x: number, y: number}

export type Level = {
    name: string;
    terrainColor: string;
    startingPosition: ObjectPosition;
    polygons: Polygon[];
    turrets: ObjectPosition[];
    powerPlant: ObjectPosition;
    podPedestal: ObjectPosition;
    fuel: ObjectPosition[];
}

export const levels: Level[] = [
    {
        name: "Level 0",
        terrainColor: bbcMicroColours.red,
        startingPosition: { x: 108, y: 401 },
        polygons: [
            // Left terrain wall
            [
                0,425, 85,425, 100,440, 121,441,
                133,453, 158,454, 158,600, 0,600
            ],
            // Right terrain wall
            [
                256,425, 182,425, 173,434,
                158,435, 158,454, 158,600, 256,600
            ],
        ],
        turrets: [
            { x: 125, y: 443 },
        ],
        powerPlant: { x: 160, y: 427 },
        podPedestal: { x: 143, y: 445 },
        fuel: [
            { x: 110, y: 435 },
        ],
    },
    {
        name: "Level 1",
        terrainColor: bbcMicroColours.yellow,
        startingPosition: { x: 108, y: 401 },
        polygons: [
            // Left terrain wall
            [
                0,429, 74,429, 85,440, 110,441,
                133,464, 133,518, 110,541,
                110,561, 125,576, 145,577, 145,700, 0,700
            ],
            // Right terrain wall
            [
                256,429, 179,429, 152,456,
                152,514, 169,531, 169,552,
                145,576, 145,700, 256,700
            ],
        ],
        turrets: [
            { x: 116, y: 532 },
            { x: 158, y: 522 },
        ],
        powerPlant: { x: 100, y: 433 },
        podPedestal: { x: 127, y: 568 },
        fuel: [
            { x: 139, y: 571 },
        ],
    },
];