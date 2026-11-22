import {
    createEditor,
    createSpace,
    type Command,
    type HostedOpening,
    type Ring,
    type Vec2,
} from '@areaform/core';
import { describe, expect, it } from 'vitest';
import {
    buildScene,
    defaultTheme,
    zoneLabelBoxes,
    type Box,
    type SceneItem,
    type SceneOptions,
} from './index.ts';

function square(x: number, y: number, size: number): Ring {
    return [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
    ];
}

/** An expo Space; `G` is its ground Level id. Commands must all succeed. */
function expo(...commands: ((G: string) => Command)[]) {
    const doc = createSpace({ name: 'Expo', kind: 'exhibition', size: [40, 25] });
    const editor = createEditor(doc);
    const G = doc.levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(G));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return { doc: editor.getDocument(), G };
}

const booth =
    (id: string, x: number, y: number, extra: object = {}) =>
    (levelId: string): Command => ({
        type: 'zone.add',
        levelId,
        zone: { id, shape: { outer: square(x, y, 3) }, category: 'booth', label: id, ...extra },
    });

const byRef = (items: SceneItem[], id: string) => items.filter((i) => i.ref.id === id);

describe('buildScene', () => {
    // The Outline's floor fill is opaque, so Underlays go above it (and below everything else).
    it('lists items in paint order: outline, underlay, zones, obstacles, stops, walls, openings, icons, labels', () => {
        const { doc, G } = expo(
            (G) => ({
                type: 'underlay.add',
                levelId: G,
                underlay: {
                    id: 'U',
                    src: 'a.png',
                    position: [0, 25],
                    scale: 0.1,
                    rotation: 0,
                    opacity: 1,
                    locked: true,
                },
            }),
            booth('A-1', 1, 1),
            (G) => ({
                type: 'obstacle.add',
                levelId: G,
                obstacle: { id: 'COL', kind: 'column', shape: { outer: square(10, 10, 1) } },
            }),
            () => ({ type: 'level.add', id: 'L2', name: 'Gallery' }),
            (G) => ({
                type: 'connection.add',
                connection: {
                    id: 'LIFT',
                    kind: 'elevator',
                    stops: [G, 'L2'].map((levelId) => ({
                        levelId,
                        shape: { outer: square(20, 20, 2) },
                    })),
                    bidirectional: true,
                },
            }),
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 8],
                b: [10, 8],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 5 },
            }),
        );

        const scene = buildScene(doc, G, { zoom: 20 });

        expect(scene.map((i) => `${i.type}:${i.ref.kind}`)).toEqual([
            'polygon:level',
            'image:underlay',
            'polygon:zone',
            'polygon:obstacle',
            'polygon:stop',
            'polygon:wall',
            'opening:opening',
            'icon:stop',
            'label:zone',
        ]);
    });

    it('only includes the requested Level', () => {
        const { doc } = expo(booth('A-1', 1, 1), () => ({
            type: 'level.add',
            id: 'L2',
            name: 'Gallery',
        }));

        const scene = buildScene(doc, 'L2', { zoom: 20 });

        expect(byRef(scene, 'A-1')).toEqual([]);
    });
});

describe('styles', () => {
    it('layers theme default → Zone Category → Document style → Style Override → highlight', () => {
        const { doc, G } = expo(
            booth('PLAIN', 1, 1, { category: undefined }),
            booth('BOOTH', 5, 1),
            booth('STYLED', 9, 1, { style: { fill: '#00ff00', opacity: 0.5 } }),
            booth('SOLD', 13, 1, { style: { fill: '#00ff00' } }),
            booth('PICKED', 17, 1),
        );
        const theme = {
            ...defaultTheme,
            zone: { fill: '#dddddd', stroke: '#999999', opacity: 1 },
            categories: { booth: { fill: '#ffcc00' } },
            highlight: { stroke: '#ff0000', strokeWidth: 3 },
        };

        const scene = buildScene(doc, G, {
            zoom: 20,
            theme,
            styleResolver: (ref) => (ref.id === 'SOLD' ? { fill: '#888888' } : undefined),
            highlight: [{ kind: 'zone', id: 'PICKED', levelId: G }],
        });
        const style = (id: string) => byRef(scene, id).find((i) => i.type === 'polygon')!.style;

        expect(style('PLAIN')).toMatchObject({ fill: '#dddddd', stroke: '#999999', opacity: 1 });
        expect(style('BOOTH')).toMatchObject({ fill: '#ffcc00', stroke: '#999999' });
        expect(style('STYLED')).toMatchObject({ fill: '#00ff00', opacity: 0.5 });
        expect(style('SOLD')).toMatchObject({ fill: '#888888' });
        expect(style('PICKED')).toMatchObject({
            fill: '#ffcc00',
            stroke: '#ff0000',
            strokeWidth: 3,
        });
    });

    it('draws Restricted Zones with the restricted style', () => {
        const { doc, G } = expo(booth('AISLE', 1, 1, { category: 'aisle', restricted: true }));

        const scene = buildScene(doc, G, { zoom: 20 });

        const aisle = byRef(scene, 'AISLE').find((i) => i.type === 'polygon');
        expect(aisle?.type === 'polygon' && aisle.style).toMatchObject(defaultTheme.restricted);
    });
});

describe('labels', () => {
    it('places a label at the visual centre of the Zone, sized in metres', () => {
        const { doc, G } = expo(booth('A-1', 1, 1));

        const label = buildScene(doc, G, { zoom: 20 }).find((i) => i.type === 'label');

        expect(label).toMatchObject({ text: 'A-1', size: defaultTheme.labelSize });
        if (label?.type !== 'label') throw new Error('expected a label');
        expect(label.position[0]).toBeCloseTo(2.5);
        expect(label.position[1]).toBeCloseTo(2.5);
    });

    it('keeps the label inside an L-shaped Zone, where the centroid falls outside', () => {
        const lShape: Ring = [
            [0, 0],
            [10, 0],
            [10, 2],
            [2, 2],
            [2, 10],
            [0, 10],
        ];
        const { doc, G } = expo((G) => ({
            type: 'zone.add',
            levelId: G,
            zone: { id: 'L', shape: { outer: lShape }, label: 'L' },
        }));

        const label = buildScene(doc, G, { zoom: 20 }).find((i) => i.type === 'label');

        if (label?.type !== 'label') throw new Error('expected a label');
        const [x, y] = label.position;
        expect(x < 2 || y < 2).toBe(true);
    });

    it('fades a name by the opacity a resolver gives it', () => {
        const { doc, G } = expo(booth('A-1', 1, 1));

        const label = buildScene(doc, G, {
            zoom: 20,
            labelResolver: () => ({ opacity: 0.4 }),
        }).find((i) => i.type === 'label');

        expect(label).toMatchObject({ text: 'A-1', style: { opacity: 0.4 } });
    });

    it('uses the Zone labelAnchor and labelSize when given', () => {
        const { doc, G } = expo(booth('A-1', 1, 1, { labelAnchor: [2.5, 3], labelSize: 0.9 }));

        const label = buildScene(doc, G, { zoom: 20 }).find((i) => i.type === 'label');

        expect(label).toMatchObject({ position: [2.5, 3], size: 0.9 });
    });

    it('wraps a long name onto two lines inside its Zone, as the 3D view does', () => {
        const { doc, G } = expo(booth('A-1', 1, 1, { label: 'Acme Robotics', labelSize: 1 }));

        const label = buildScene(doc, G, { zoom: 20, measure: (t) => t.length * 0.5 }).find(
            (i) => i.type === 'label',
        );

        expect(label).toMatchObject({ text: 'Acme Robotics', lines: ['Acme', 'Robotics'] });
        if (label?.type !== 'label') throw new Error('expected a label');
        // Robotics, 4 font heights wide plus margins, in a 3 m booth.
        expect(label.size).toBeLessThan(1);
    });

    it("draws the label in the Zone's labelColor, or the Theme's label colour", () => {
        const { doc, G } = expo(booth('A-1', 1, 1, { labelColor: '#ffffff' }), booth('A-2', 5, 1));

        const labels = buildScene(doc, G, { zoom: 20 }).filter((i) => i.type === 'label');

        expect(labels.map((l) => l.style.fill)).toEqual(['#ffffff', defaultTheme.label.fill]);
    });

    it('hides labels that would be smaller than the minimum on-screen size', () => {
        const { doc, G } = expo(booth('A-1', 1, 1, { labelSize: 0.5 }));
        const minPx = defaultTheme.minLabelPx;

        expect(
            buildScene(doc, G, { zoom: (minPx / 0.5) * 0.9 }).some((i) => i.type === 'label'),
        ).toBe(false);
        expect(
            buildScene(doc, G, { zoom: (minPx / 0.5) * 1.1 }).some((i) => i.type === 'label'),
        ).toBe(true);
    });
});

describe('Connection icons', () => {
    const lift =
        (kind: 'stairs' | 'elevator' | 'escalator' | 'ramp', size: number) =>
        (G: string): Command => ({
            type: 'connection.add',
            connection: {
                id: 'C',
                kind,
                stops: [G, 'L2'].map((levelId) => ({
                    levelId,
                    shape: { outer: square(20, 10, size) },
                })),
                bidirectional: true,
            },
        });
    const withLevel2 = () => ({ type: 'level.add', id: 'L2', name: 'Gallery' }) as const;
    const iconOf = (items: SceneItem[]) => items.find((i) => i.type === 'icon');

    it("puts the Connection kind's icon in the middle of each Stop on the Level", () => {
        for (const kind of ['stairs', 'elevator', 'escalator', 'ramp'] as const) {
            const { doc, G } = expo(withLevel2, lift(kind, 3));

            const icon = iconOf(buildScene(doc, G, { zoom: 20 }));

            expect(icon).toMatchObject({
                type: 'icon',
                ref: { kind: 'stop', id: 'C', levelId: G },
                kind,
                svg: defaultTheme.connectionIcons[kind],
                size: defaultTheme.connectionIconSize,
            });
            if (icon?.type !== 'icon') throw new Error('expected an icon');
            expect(icon.position[0]).toBeCloseTo(21.5);
            expect(icon.position[1]).toBeCloseTo(11.5);
        }
    });

    it('has a distinct SVG icon for every kind', () => {
        const icons = Object.values(defaultTheme.connectionIcons);
        expect(icons).toHaveLength(4);
        expect(new Set(icons).size).toBe(4);
        for (const svg of icons) expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
    });

    it('shrinks the icon to fit a small Stop, and leaves it out when too small to see', () => {
        const { doc, G } = expo(withLevel2, lift('elevator', 1));

        const icon = iconOf(buildScene(doc, G, { zoom: 20 }));
        expect(icon?.type === 'icon' && icon.size).toBeLessThan(1);
        expect(iconOf(buildScene(doc, G, { zoom: 2 }))).toBeUndefined();
    });

    it('takes its icons from the Theme, so a host can replace them', () => {
        const { doc, G } = expo(withLevel2, lift('stairs', 3));
        const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
        const theme = {
            ...defaultTheme,
            connectionIcons: { ...defaultTheme.connectionIcons, stairs: svg },
        };

        expect(iconOf(buildScene(doc, G, { zoom: 20, theme }))).toMatchObject({ svg });
    });
});

describe('zoneLabelBoxes', () => {
    it('gives the box each shown Zone name covers, centred where the scene draws it', () => {
        const { doc, G } = expo(
            booth('A-1', 1, 1),
            booth('B-1', 10, 1, { label: 'Meeting room', labelAnchor: [11, 2] }),
            booth('C-1', 20, 1, { label: undefined }),
        );
        const level = doc.levels.find((l) => l.id === G)!;

        const boxes = zoneLabelBoxes(level, 20);

        expect(boxes).toHaveLength(2);
        const [short, long] = boxes as [Box, Box];
        const middle = (b: Box): Vec2 => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
        expect(middle(short)[0]).toBeCloseTo(2.5);
        expect(middle(short)[1]).toBeCloseTo(2.5);
        expect(middle(long)).toEqual([11, 2]);
        expect(short.maxY - short.minY).toBeCloseTo(defaultTheme.labelSize);
        // A longer name is wider, and wider than it is tall.
        expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);
        expect(long.maxX - long.minX).toBeGreaterThan(long.maxY - long.minY);
    });

    it('leaves out names too small to be drawn', () => {
        const { doc, G } = expo(booth('A-1', 1, 1));
        const level = doc.levels.find((l) => l.id === G)!;

        expect(zoneLabelBoxes(level, 1)).toEqual([]);
    });
});

describe('walls and openings', () => {
    it('draws a lone Wall as a rectangle along its centre-line', () => {
        const { doc, G } = expo((G) => ({
            type: 'wall.add',
            levelId: G,
            id: 'W',
            a: [0, 5],
            b: [10, 5],
            thickness: 0.2,
        }));

        const wall = byRef(buildScene(doc, G, { zoom: 20 }), 'W')[0];

        expect(wall?.type === 'polygon' && wall.shape.outer).toEqual([
            [0, 4.9],
            [10, 4.9],
            [10, 5.1],
            [0, 5.1],
        ]);
    });

    it('places an Opening on its Wall with the Wall thickness', () => {
        const { doc, G } = expo(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [0, 15],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: {
                    id: 'D',
                    kind: 'door',
                    width: 0.9,
                    host: 'wall',
                    wallId: 'W',
                    offset: 3,
                },
            }),
        );

        const opening = byRef(buildScene(doc, G, { zoom: 20 }), 'D')[0];

        expect(opening).toMatchObject({ type: 'opening', kind: 'door', width: 0.9, depth: 0.2 });
        if (opening?.type !== 'opening') throw new Error('expected an opening');
        expect(opening.position[0]).toBeCloseTo(0);
        expect(opening.position[1]).toBeCloseTo(8);
        expect(opening.angle).toBeCloseTo(Math.PI / 2);
    });

    it('passes on which jamb a door hangs from and which way it swings', () => {
        const door =
            (id: string, offset: number, swing: Pick<HostedOpening, 'hinge' | 'swing'> = {}) =>
            (G: string): Command => ({
                type: 'opening.add',
                levelId: G,
                opening: {
                    id,
                    kind: 'door',
                    width: 0.9,
                    host: 'wall',
                    wallId: 'W',
                    offset,
                    ...swing,
                },
            });
        const { doc, G } = expo(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            }),
            door('D1', 2),
            door('D2', 5, { hinge: 'end', swing: 'right' }),
        );
        const scene = buildScene(doc, G, { zoom: 20 });

        expect(byRef(scene, 'D1')[0]).toMatchObject({ hinge: 'start', swing: 'left' });
        expect(byRef(scene, 'D2')[0]).toMatchObject({ hinge: 'end', swing: 'right' });
    });

    it('tells which side of an Opening on the Outline is inside, so entrances can point in', () => {
        // The expo Outline is 40 × 25 from the origin.
        const { doc, G } = expo(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'S',
                a: [0, 0],
                b: [40, 0],
                thickness: 0.3,
            }),
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'N',
                a: [40, 25],
                b: [0, 25],
                thickness: 0.3,
            }),
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'X',
                a: [10, 5],
                b: [10, 15],
                thickness: 0.1,
            }),
            ...(
                [
                    ['E1', 'S'],
                    ['E2', 'N'],
                    ['P', 'X'],
                ] as const
            ).map(([id, wallId]) => (G: string): Command => ({
                type: 'opening.add',
                levelId: G,
                opening: { id, kind: 'entrance', width: 3, host: 'wall', wallId, offset: 5 },
            })),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: {
                    id: 'F',
                    kind: 'emergency-exit',
                    width: 2,
                    host: 'free',
                    position: [0, 12],
                    angle: Math.PI / 2,
                },
            }),
        );
        const scene = buildScene(doc, G, { zoom: 20 });
        const inside = (id: string) => {
            const item = byRef(scene, id)[0];
            return item?.type === 'opening' ? item.inside : 'missing';
        };

        expect(inside('E1')).toBe('left');
        expect(inside('E2')).toBe('left');
        // Facing north along the west edge, the building is on the right.
        expect(inside('F')).toBe('right');
        // A gap in an inner Wall has building on both sides.
        expect(inside('P')).toBeUndefined();
    });

    it('draws emergency exits in their own colour', () => {
        const { doc, G } = expo((G) => ({
            type: 'opening.add',
            levelId: G,
            opening: {
                id: 'F',
                kind: 'emergency-exit',
                width: 2,
                host: 'free',
                position: [0, 12],
                angle: Math.PI / 2,
            },
        }));

        const exit = byRef(buildScene(doc, G, { zoom: 20 }), 'F')[0];

        expect(exit).toMatchObject({ style: defaultTheme.emergencyExit });
        expect(defaultTheme.emergencyExit.stroke).not.toBe(defaultTheme.opening.stroke);
    });

    it('drops Openings and small Obstacles when they would be too small to see', () => {
        const { doc, G } = expo(
            (G) => ({
                type: 'wall.add',
                levelId: G,
                id: 'W',
                a: [0, 5],
                b: [10, 5],
                thickness: 0.2,
            }),
            (G) => ({
                type: 'opening.add',
                levelId: G,
                opening: { id: 'D', kind: 'door', width: 1, host: 'wall', wallId: 'W', offset: 3 },
            }),
            (G) => ({
                type: 'obstacle.add',
                levelId: G,
                obstacle: { id: 'COL', kind: 'column', shape: { outer: square(20, 20, 0.4) } },
            }),
        );
        const tiny = defaultTheme.minFeaturePx / 2;

        const scene = buildScene(doc, G, { zoom: tiny });

        expect(byRef(scene, 'D')).toEqual([]);
        expect(byRef(scene, 'COL')).toEqual([]);
        expect(byRef(scene, 'W')).toHaveLength(1);
    });

    it('resolves Underlay images through the host, keeping the Document as it is', () => {
        const { doc } = expo((G) => ({
            type: 'underlay.add',
            levelId: G,
            underlay: {
                id: 'U',
                src: 'source.png',
                position: [0, 25],
                scale: 0.1,
                rotation: 0,
                opacity: 0.5,
                locked: true,
            },
        }));
        const levelId = doc.levels[0]!.id;
        const images = (options: SceneOptions) =>
            buildScene(doc, levelId, options).filter((item) => item.type === 'image');
        expect(images({ zoom: 10, resolveAsset: (src) => `blob:test/${src}` })).toMatchObject([
            { src: 'blob:test/source.png' },
        ]);
        expect(images({ zoom: 10 })).toMatchObject([{ src: 'source.png' }]);
        expect(doc.levels[0]!.underlays[0]!.src).toBe('source.png');
    });
});
