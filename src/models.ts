import {bbcMicroColours} from "./rendering";

export type Polygon = {
    colour: string;
    vertices: number[];
}

export type Model = Polygon[];

export const playerShip : Model = [
    {
        colour: bbcMicroColours.yellow,
        /*vertices: [
            13,0,
            23,19,
            26,20,
            19,30,
            15,26,
            11,26,
            7,30,
            0,20,
            3,19
        ]*/
        vertices: [
            8, 0,
            12, 9,
            16, 10,
            12, 15,
            9, 13,
            7, 13,
            4, 15,
            0, 10,
            4, 9
        ]
    }
];
