// A three-level office made from a Figma frame through the Areaform MCP server (a Draft, then
// edited by Commands): the ground floor traced from the Areaform logo, P1 parking with a car
// ramp, B2 plant rooms, and stair and lift cores through all three. Its Import Flags were reviewed
// and marked done, leaving an empty list as the Review panel does; it keeps its Figma image as the ground floor
// Underlay. The playground opens with it.
import { fromJSON, type AreaformDocument } from '@areaform/core';
import plan from '../../server/demo/office.json?raw';
import { describeLoadErrors } from './storage.ts';

export function sampleOffice(): AreaformDocument {
    const loaded = fromJSON(plan);
    if (!loaded.ok) {
        throw new Error(
            `The Office demo could not be opened: ${describeLoadErrors(loaded.errors)}`,
        );
    }
    return loaded.doc;
}
