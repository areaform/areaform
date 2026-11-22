import { createEditor, createSpace, type Command, type Level, type Ring } from '@areaform/core';
import { zoneLabelBoxes, type Box, type OverlayItem } from '@areaform/render-2d';
import { describe, expect, it } from 'vitest';
import { levelDimensionLabels, overlayLabelBox } from './dimensions.ts';
import { harness } from './testing.ts';

type Label = Extract<OverlayItem, { type: 'label' }>;

function levelWith(...commands: ((levelId: string) => Command)[]): Level {
    const editor = createEditor(createSpace({ name: 'T', kind: 'office', size: [40, 20] }));
    const levelId = editor.getDocument().levels[0]!.id;
    for (const command of commands) {
        const result = editor.exec(command(levelId));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    }
    return editor.getDocument().levels[0]!;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];

const overlaps = (a: Box, b: Box) =>
    a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

const labelsOf = (items: OverlayItem[]) => items.filter((i): i is Label => i.type === 'label');

describe('Always-on dimension labels keep clear of names and of each other', () => {
    it('slides a Wall label along its Wall, off the Zone name it would cover', () => {
        const zoom = 15;
        const level = levelWith(
            (levelId) => ({
                type: 'zone.add',
                levelId,
                zone: { shape: { outer: rect(0, 0, 4, 8) }, label: 'Meeting room' },
            }),
            (levelId) => ({ type: 'wall.add', levelId, a: [0, 0], b: [0, 8], thickness: 0.15 }),
        );

        const [label] = labelsOf(levelDimensionLabels(level, zoom));
        const [name] = zoneLabelBoxes(level, zoom);

        expect(label?.text).toBe('8.00 m');
        expect(label!.position[0]).toBeCloseTo(0);
        expect(overlaps(overlayLabelBox(label!, zoom), name!)).toBe(false);
    });

    it('never overlaps two labels: a crowded stack of Walls shows only the ones that fit', () => {
        const zoom = 20;
        const walls = [0, 1, 2, 3, 4, 5].map((i) => (levelId: string): Command => ({
            type: 'wall.add',
            levelId,
            a: [0, 5 + i * 0.2],
            b: [10, 5 + i * 0.2],
            thickness: 0.05,
        }));
        const labels = labelsOf(levelDimensionLabels(levelWith(...walls), zoom));
        const boxes = labels.map((l) => overlayLabelBox(l, zoom));

        expect(labels.length).toBeGreaterThan(1);
        expect(labels.length).toBeLessThan(6);
        boxes.forEach((a, i) =>
            boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
        );
    });

    it('moves a size label to the top of its Zone when a name sits at the bottom', () => {
        const zoom = 20;
        const level = levelWith((levelId) => ({
            type: 'zone.add',
            levelId,
            zone: { shape: { outer: rect(0, 0, 10, 6) }, label: 'Stage', labelAnchor: [5, 1.2] },
        }));

        const [label] = labelsOf(levelDimensionLabels(level, zoom));

        expect(label?.text).toMatch(/^10\.00 × 6\.00 m/);
        expect(label!.position[1]).toBeGreaterThan(3);
        expect(overlaps(overlayLabelBox(label!, zoom), zoneLabelBoxes(level, zoom)[0]!)).toBe(
            false,
        );
    });
});

describe('The rotation handle keeps clear of names', () => {
    /** Booth A (3 × 2 m) selected, with booth B and its name right above it. */
    function boothUnderName() {
        const h = harness('exhibition');
        const { levelId } = h;
        h.editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id: 'A', shape: { outer: rect(2, 2, 5, 4) }, label: 'A' },
        });
        h.editor.exec({
            type: 'zone.add',
            levelId,
            zone: { id: 'B', shape: { outer: rect(2, 4, 5, 7) }, label: 'B-1' },
        });
        h.controller.setZoom(15);
        h.controller.select([{ kind: 'zone', id: 'A', levelId }]);
        const handle = () =>
            h.controller
                .getState()
                .overlay.find(
                    (i): i is Extract<OverlayItem, { type: 'marker' }> =>
                        i.type === 'marker' && i.kind === 'node',
                )!.position;
        return { ...h, handle };
    }

    it('moves the handle beside the selection when a name is above it', () => {
        const h = boothUnderName();

        const [x, y] = h.handle();
        expect(x).toBeGreaterThan(5);
        expect(y).toBeCloseTo(3);
    });

    it('stays above the selection when nothing is in the way', () => {
        const h = boothUnderName();
        h.editor.exec({
            type: 'zone.update',
            levelId: h.levelId,
            zoneId: 'B',
            changes: { label: undefined },
        });

        const [x, y] = h.handle();
        expect(x).toBeCloseTo(3.5);
        expect(y).toBeGreaterThan(4);
    });

    it('still turns the selection from where it moved to', () => {
        const h = boothUnderName();
        const [x, y] = h.handle();

        // From the right of the centre (3.5, 3) to straight above it: a quarter turn.
        h.drag([x, y], [3.5, 3 + (x - 3.5)]);

        const outer = h.level().zones.find((z) => z.id === 'A')!.shape.outer;
        const xs = outer.map((p) => p[0]);
        const ys = outer.map((p) => p[1]);
        expect(Math.min(...xs)).toBeCloseTo(2.5);
        expect(Math.max(...xs)).toBeCloseTo(4.5);
        expect(Math.min(...ys)).toBeCloseTo(1.5);
        expect(Math.max(...ys)).toBeCloseTo(4.5);
    });
});
