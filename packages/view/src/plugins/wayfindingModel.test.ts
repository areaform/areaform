import { createEditor, createSpace } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { createTranslator, english } from '../i18n/translator.ts';
import {
    framed,
    levelName,
    parseHere,
    parseTo,
    rideText,
    walkSummary,
    zonePoint,
} from './wayfindingModel.ts';

function hall() {
    const editor = createEditor(createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] }));
    const L = editor.getDocument().levels[0]!.id;
    editor.exec({ type: 'level.add', id: 'L2', name: 'Level 2' });
    editor.exec({
        type: 'zone.add',
        levelId: 'L2',
        zone: {
            id: 'cafe',
            shape: {
                outer: [
                    [2, 2],
                    [6, 2],
                    [6, 4],
                    [2, 4],
                ],
            },
        },
    });
    return { doc: editor.getDocument(), L };
}

describe('zonePoint', () => {
    it('is the label anchor, else the middle of the shape', () => {
        const ring: [number, number][] = [
            [0, 0],
            [4, 0],
            [4, 2],
            [0, 2],
        ];
        expect(zonePoint({ id: 'Z', shape: { outer: ring } })).toEqual([2, 1]);
        expect(zonePoint({ id: 'Z', shape: { outer: ring }, labelAnchor: [1, 1] })).toEqual([1, 1]);
    });

    it('stays inside an L-shaped Zone whose middle is outside it', () => {
        const L: [number, number][] = [
            [0, 0],
            [4, 0],
            [4, 1],
            [1, 1],
            [1, 4],
            [0, 4],
        ];
        const [x, y] = zonePoint({ id: 'Z', shape: { outer: L } });
        expect(x <= 1 || y <= 1).toBe(true);
    });
});

describe('parseTo', () => {
    it("takes a Zone's id, on whichever Level it is", () => {
        const { doc } = hall();
        expect(parseTo(' cafe ', doc)).toMatchObject({ levelId: 'L2', zone: { id: 'cafe' } });
    });

    it('is null for nothing, an unknown id, or a point', () => {
        const { doc, L } = hall();
        expect(parseTo(undefined, doc)).toBeNull();
        expect(parseTo('', doc)).toBeNull();
        expect(parseTo('nowhere', doc)).toBeNull();
        expect(parseTo(`${L}:1,2`, doc)).toBeNull();
    });
});

describe('parseHere', () => {
    it("takes a Zone's id, on whichever Level it is", () => {
        const { doc } = hall();
        expect(parseHere('cafe', doc)).toEqual({ levelId: 'L2', point: [4, 3] });
    });

    it('takes a point on a Level', () => {
        const { doc, L } = hall();
        expect(parseHere(`${L}:12.5,-3`, doc)).toEqual({ levelId: L, point: [12.5, -3] });
        expect(parseHere(' L2:1,2 ', doc)).toEqual({ levelId: 'L2', point: [1, 2] });
    });

    it('is null for nothing, or for what the Space does not have', () => {
        const { doc } = hall();
        expect(parseHere(undefined, doc)).toBeNull();
        expect(parseHere('', doc)).toBeNull();
        expect(parseHere('nowhere', doc)).toBeNull();
        expect(parseHere('L9:1,2', doc)).toBeNull();
        expect(parseHere('L2:1;2', doc)).toBeNull();
    });
});

describe('walkSummary', () => {
    it('gives whole metres and minutes at 1.2 m/s, at least one of each', () => {
        expect(walkSummary(143.6, english)).toBe('144 m · 2 min');
        expect(walkSummary(0.2, english)).toBe('1 m · 1 min');
    });

    it('counts the rides of a route between Levels in its time', () => {
        expect(walkSummary(60, english, 150)).toBe('60 m · 3 min');
    });

    it('is in the interface language', () => {
        expect(walkSummary(1250, createTranslator('ru'))).toBe('1250 м · 17 мин');
    });
});

describe('rideText', () => {
    function withStairs(name?: string) {
        const { doc, L } = hall();
        const editor = createEditor(doc);
        const square = {
            outer: [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
            ] as [number, number][],
        };
        editor.exec({
            type: 'connection.add',
            connection: {
                id: 'S',
                kind: 'stairs',
                ...(name && { name }),
                stops: [L, 'L2'].map((levelId) => ({ levelId, shape: square })),
                bidirectional: true,
            },
        });
        editor.exec({
            type: 'space.update',
            changes: { languages: { default: 'en', others: ['pl'] } },
        });
        editor.exec({
            type: 'text.set',
            target: { kind: 'level', levelId: 'L2' },
            language: 'pl',
            text: 'Poziom 2',
        });
        return { doc: editor.getDocument(), L };
    }
    const up = { connectionId: 'S', kind: 'stairs' as const, toLevelId: 'L2', up: true };

    it('says the kind, the way and the Level gone to', () => {
        const { doc, L } = withStairs();
        expect(rideText(doc, up, english)).toBe('Take the stairs up to Level 2');
        expect(rideText(doc, { ...up, toLevelId: L, up: false }, english)).toBe(
            `Take the stairs down to ${levelName(doc, L)}`,
        );
    });

    it('uses the Connection’s name, and the Level’s name in the language shown', () => {
        const { doc } = withStairs('Main stairs');
        expect(rideText(doc, up, english)).toBe('Take Main stairs up to Level 2');
        expect(rideText(doc, up, createTranslator('pl'), 'pl')).toBe(
            'Main stairs w górę: Poziom 2',
        );
    });
});

describe('framed', () => {
    // 800 × 600 px, 10 px a metre, centred on (40, 30): the plan 0–80 × 0–60 m fills the View.
    const camera = {
        viewport: { width: 800, height: 600 },
        center: [40, 30] as [number, number],
        zoom: 10,
        minZoom: 1,
        maxZoom: 100,
    };
    // Above a route panel 150 px high.
    const area = { left: 40, top: 40, right: 760, bottom: 450 };
    const onScreen = (c: typeof camera, [x, y]: [number, number]) => [
        c.viewport.width / 2 + (x - c.center[0]) * c.zoom,
        c.viewport.height / 2 - (y - c.center[1]) * c.zoom,
    ];

    it('leaves the camera when everything is in the area', () => {
        expect(
            framed(
                camera,
                [
                    [20, 30],
                    [60, 40],
                ],
                area,
            ),
        ).toBeNull();
        expect(framed(camera, [], area)).toBeNull();
    });

    it('pans an end hidden under the panel into the area, keeping the zoom', () => {
        // y = 3 m is 570 px down: under the panel.
        const moved = framed(
            camera,
            [
                [20, 30],
                [45, 3],
            ],
            area,
        )!;
        expect(moved.zoom).toBe(10);
        for (const p of [
            [20, 30],
            [45, 3],
        ] as [number, number][]) {
            const [sx, sy] = onScreen(moved, p);
            expect(sx).toBeGreaterThanOrEqual(area.left);
            expect(sx).toBeLessThanOrEqual(area.right);
            expect(sy).toBeGreaterThanOrEqual(area.top);
            expect(sy).toBeLessThanOrEqual(area.bottom);
        }
    });

    it('zooms out when the points do not fit, never below the least zoom', () => {
        const moved = framed(
            camera,
            [
                [0, -10],
                [80, 60],
            ],
            area,
        )!;
        expect(moved.zoom).toBeCloseTo(410 / 70);
        const [, top] = onScreen(moved, [80, 60]);
        const [, bottom] = onScreen(moved, [0, -10]);
        expect(top).toBeCloseTo(area.top);
        expect(bottom).toBeCloseTo(area.bottom);
        expect(
            framed(
                { ...camera, minZoom: 8 },
                [
                    [0, -10],
                    [80, 60],
                ],
                area,
            )!.zoom,
        ).toBe(8);
    });
});
