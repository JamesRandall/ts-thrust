// Auto-generated from Thrust 6502 assembly source
// Decoded by decode-levels.ts

export type Polygon = Array<number>;
export type ObjectPosition = { x: number, y: number};
export type TurretDirection = 'up_left' | 'up_right' | 'down_left' | 'down_right';
export type TurretPosition = ObjectPosition & { direction: TurretDirection; gunParam: number };
export type SwitchDirection = 'left' | 'right';
export type SwitchPosition = ObjectPosition & { direction: SwitchDirection };
export type DoorType = 'slide' | 'step' | 'chevron';
export type DoorConfig = {
    type: DoorType;
    worldY: number;
    threshold: number;
    scanlines: number;
    closedX: number;
    openX: number;
    innerX: number;
};

export type SpawnPoint = {
    midpointX: number;
    midpointY: number;
    windowX: number;
    windowY: number;
};

export type Level = {
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

export const bbcMicroColours = {
    black: "black",
    red: "red",
    green: "green",
    yellow: "yellow",
    blue: "blue",
    magenta: "magenta",
    cyan: "cyan",
    white: "white",
};

export const levels: Level[] = [
    {
        name: "Level 0",
        terrainColor: bbcMicroColours.red,
        objectColor: bbcMicroColours.green,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
        ],
        polygons: [
            // Left terrain wall
            [
                0,425, 85,425, 100,440, 121,441,
                133,453, 158,454, 158,600, 0,600
            ],
            // Right terrain wall
            [
                256,425, 182,425, 173,434, 158,435,
                158,600, 256,600
            ],
        ],
        turrets: [
            { x: 125, y: 443, direction: 'up_right', gunParam: 0x1e },
        ],
        powerPlant: { x: 160, y: 427 },
        podPedestal: { x: 143, y: 445 },
        fuel: [
            { x: 110, y: 435 },
        ],
        switches: [],
        doorConfig: null,
    },
    {
        name: "Level 1",
        terrainColor: bbcMicroColours.green,
        objectColor: bbcMicroColours.red,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
        ],
        polygons: [
            // Left terrain wall
            [
                0,429, 74,429, 85,440, 110,441,
                133,464, 133,518, 110,541, 110,561,
                125,576, 145,577, 145,750, 0,750
            ],
            // Right terrain wall
            [
                256,429, 179,429, 152,456, 152,514,
                169,531, 169,552, 145,576, 145,750,
                256,750
            ],
        ],
        turrets: [
            { x: 116, y: 532, direction: 'down_right', gunParam: 0x06 },
            { x: 158, y: 522, direction: 'down_left', gunParam: 0x0f },
        ],
        powerPlant: { x: 100, y: 433 },
        podPedestal: { x: 127, y: 568 },
        fuel: [
            { x: 139, y: 571 },
        ],
        switches: [],
        doorConfig: null,
    },
    {
        name: "Level 2",
        terrainColor: bbcMicroColours.cyan,
        objectColor: bbcMicroColours.green,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
            { midpointX: 138, midpointY: 557, windowX: 111, windowY: 426 }, // checkpoint 1
            { midpointX: 76, midpointY: 662, windowX: 50, windowY: 547 }, // checkpoint 2
        ],
        polygons: [
            // Left terrain wall
            [
                0,439, 135,439, 135,519, 125,529,
                125,579, 95,580, 85,590, 85,620,
                70,621, 60,631, 60,716, 70,726,
                91,727, 91,900, 0,900
            ],
            // Right terrain wall
            [
                256,439, 179,439, 179,458, 156,459,
                156,519, 180,520, 180,540, 170,550,
                150,551, 150,611, 120,612, 120,662,
                100,663, 91,672, 91,900, 256,900
            ],
        ],
        turrets: [
            { x: 93, y: 663, direction: 'up_left', gunParam: 0x1b },
            { x: 62, y: 626, direction: 'down_right', gunParam: 0x06 },
            { x: 88, y: 584, direction: 'down_right', gunParam: 0x0a },
            { x: 171, y: 542, direction: 'up_left', gunParam: 0x16 },
            { x: 129, y: 522, direction: 'down_right', gunParam: 0x04 },
        ],
        powerPlant: { x: 164, y: 451 },
        podPedestal: { x: 78, y: 718 },
        fuel: [
            { x: 120, y: 433 },
            { x: 151, y: 545 },
            { x: 157, y: 545 },
            { x: 163, y: 545 },
            { x: 125, y: 606 },
            { x: 103, y: 657 },
        ],
        switches: [],
        doorConfig: null,
    },
    {
        name: "Level 3",
        terrainColor: bbcMicroColours.green,
        objectColor: bbcMicroColours.magenta,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
            { midpointX: 127, midpointY: 486, windowX: 87, windowY: 352 }, // checkpoint 1
            { midpointX: 165, midpointY: 586, windowX: 118, windowY: 472 }, // checkpoint 2
        ],
        polygons: [
            // Left terrain wall
            [
                0,414, 90,414, 109,433, 126,434,
                126,455, 88,493, 88,513, 98,523,
                98,529, 78,549, 78,583, 103,584,
                123,604, 156,605, 156,643, 128,671,
                128,707, 138,717, 138,1150, 0,1150
            ],
            // Right terrain wall
            [
                256,414, 140,414, 140,517, 110,518,
                110,536, 134,560, 174,561, 174,693,
                150,717, 150,737, 138,738, 138,1150,
                256,1150
            ],
        ],
        turrets: [
            { x: 114, y: 464, direction: 'down_right', gunParam: 0x06 },
            { x: 90, y: 513, direction: 'up_right', gunParam: 0x06 },
            { x: 90, y: 534, direction: 'down_right', gunParam: 0x06 },
            { x: 120, y: 548, direction: 'down_left', gunParam: 0x12 },
            { x: 109, y: 588, direction: 'up_right', gunParam: 0x1f },
            { x: 138, y: 658, direction: 'down_right', gunParam: 0x06 },
            { x: 162, y: 698, direction: 'up_left', gunParam: 0x1e },
        ],
        powerPlant: { x: 91, y: 576 },
        podPedestal: { x: 142, y: 729 },
        fuel: [
            { x: 146, y: 599 },
        ],
        switches: [
            { x: 172, y: 593, direction: 'left' },
            { x: 172, y: 647, direction: 'left' },
        ],
        doorConfig: { type: 'slide', worldY: 617, threshold: 16, scanlines: 13, closedX: 174, openX: 158, innerX: 156 },
    },
    {
        name: "Level 4",
        terrainColor: bbcMicroColours.red,
        objectColor: bbcMicroColours.magenta,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
            { midpointX: 127, midpointY: 616, windowX: 88, windowY: 494 }, // checkpoint 1
            { midpointX: 111, midpointY: 732, windowX: 67, windowY: 614 }, // checkpoint 2
            { midpointX: 133, midpointY: 789, windowX: 100, windowY: 671 }, // checkpoint 3
        ],
        polygons: [
            // Left terrain wall
            [
                0,419, 88,419, 109,440, 109,462,
                132,463, 132,519, 122,520, 110,532,
                110,560, 120,561, 120,601, 100,621,
                80,622, 80,708, 100,728, 100,742,
                90,743, 90,771, 102,783, 120,784,
                120,814, 132,826, 152,827, 152,909,
                160,917, 170,918, 170,1050, 0,1050
            ],
            // Right terrain wall
            [
                256,419, 146,419, 146,519, 160,520,
                170,530, 170,560, 134,561, 134,601,
                142,602, 142,642, 132,652, 98,653,
                98,687, 130,719, 130,763, 140,764,
                150,774, 150,796, 166,797, 166,859,
                182,875, 182,905, 170,917, 170,1050,
                256,1050
            ],
        ],
        turrets: [
            { x: 114, y: 525, direction: 'down_right', gunParam: 0x05 },
            { x: 162, y: 524, direction: 'down_left', gunParam: 0x14 },
            { x: 134, y: 643, direction: 'up_left', gunParam: 0x1a },
            { x: 93, y: 772, direction: 'up_right', gunParam: 0x02 },
            { x: 142, y: 768, direction: 'down_left', gunParam: 0x12 },
            { x: 123, y: 815, direction: 'up_right', gunParam: 0x1e },
            { x: 172, y: 867, direction: 'down_left', gunParam: 0x19 },
        ],
        powerPlant: { x: 143, y: 553 },
        podPedestal: { x: 162, y: 909 },
        fuel: [
            { x: 124, y: 457 },
            { x: 154, y: 555 },
            { x: 160, y: 555 },
            { x: 104, y: 647 },
            { x: 105, y: 778 },
            { x: 111, y: 778 },
            { x: 137, y: 821 },
            { x: 143, y: 821 },
        ],
        switches: [
            { x: 164, y: 805, direction: 'left' },
            { x: 152, y: 885, direction: 'right' },
        ],
        doorConfig: { type: 'step', worldY: 835, threshold: 21, scanlines: 21, closedX: 166, openX: 152, innerX: 152 },
    },
    {
        name: "Level 5",
        terrainColor: bbcMicroColours.magenta,
        objectColor: bbcMicroColours.cyan,
        spawnPoints: [
            { midpointX: 112, midpointY: 401, windowX: 86, windowY: 292 }, // initial spawn
            { midpointX: 166, midpointY: 587, windowX: 140, windowY: 472 }, // checkpoint 1
            { midpointX: 158, midpointY: 724, windowX: 130, windowY: 602 }, // checkpoint 2
            { midpointX: 139, midpointY: 810, windowX: 110, windowY: 692 }, // checkpoint 3
            { midpointX: 178, midpointY: 920, windowX: 135, windowY: 795 }, // checkpoint 4
        ],
        polygons: [
            // Left terrain wall
            [
                0,381, 77,381, 77,443, 100,444,
                180,524, 180,564, 160,565, 150,575,
                150,737, 133,738, 133,792, 120,805,
                120,825, 174,879, 174,893, 161,906,
                161,937, 151,947, 151,1004, 162,1005,
                162,1200, 0,1200
            ],
            // Right terrain wall
            [
                256,381, 182,381, 139,424, 139,444,
                194,499, 194,564, 214,584, 214,604,
                189,605, 161,633, 161,667, 179,685,
                179,705, 169,715, 169,765, 148,766,
                148,805, 192,849, 192,879, 199,886,
                192,893, 192,949, 164,977, 164,1012,
                177,1013, 177,1035, 162,1036, 162,1200,
                256,1200
            ],
        ],
        turrets: [
            { x: 175, y: 959, direction: 'up_left', gunParam: 0x1a },
            { x: 155, y: 940, direction: 'down_right', gunParam: 0x06 },
            { x: 162, y: 902, direction: 'down_right', gunParam: 0x09 },
            { x: 155, y: 814, direction: 'down_left', gunParam: 0x12 },
            { x: 123, y: 799, direction: 'down_right', gunParam: 0x06 },
            { x: 172, y: 705, direction: 'up_left', gunParam: 0x16 },
            { x: 172, y: 680, direction: 'down_left', gunParam: 0x12 },
            { x: 172, y: 615, direction: 'up_left', gunParam: 0x1b },
            { x: 202, y: 574, direction: 'down_left', gunParam: 0x12 },
            { x: 153, y: 569, direction: 'down_right', gunParam: 0x05 },
            { x: 153, y: 460, direction: 'down_left', gunParam: 0x0e },
        ],
        powerPlant: { x: 169, y: 1028 },
        podPedestal: { x: 154, y: 996 },
        fuel: [
            { x: 154, y: 760 },
            { x: 193, y: 599 },
        ],
        switches: [
            { x: 161, y: 920, direction: 'right' },
            { x: 190, y: 861, direction: 'left' },
        ],
        doorConfig: { type: 'chevron', worldY: 880, threshold: 18, scanlines: 15, closedX: 192, openX: 174, innerX: 174 },
    },
];
