import { createEditor, createSpace, type Level, type Vec2 } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { snap, type SnapContext } from '../index.ts';

/** A 20 × 10 m office Level with one Wall along y = 5 and a booth Zone at (12, 1)–(15, 4). */
function office(): Level {
    const doc = createSpace({ name: 'Office', kind: 'office', size: [20, 10] });
    const editor = createEditor(doc);
    const levelId = doc.levels[0]!.id;
    editor.exec({ type: 'wall.add', levelId, a: [0, 5], b: [10, 5], thickness: 0.1 });
    editor.exec({
        type: 'zone.add',
        levelId,
        zone: {
            id: 'Z',
            shape: {
                outer: [
                    [12, 1],
                    [15, 1],
                    [15, 4],
                    [12, 4],
                ],
            },
        },
    });
    return editor.getDocument().levels[0]!;
}

function context(overrides: Partial<SnapContext> = {}): SnapContext {
    return { level: office(), grid: { step: 1, snap: true }, tolerance: 0.3, ...overrides };
}

function expectPoint(actual: Vec2, expected: Vec2) {
    expect(actual[0]).toBeCloseTo(expected[0]);
    expect(actual[1]).toBeCloseTo(expected[1]);
}

describe('snap', () => {
    it('snaps to a nearby Wall Node before anything else', () => {
        const ctx = context();
        const node = ctx.level.wallNodes.find((n) => n.position[0] === 10)!;

        const result = snap([10.2, 5.1], ctx);

        expect(result).toEqual({
            point: [10, 5],
            kind: 'node',
            ref: { kind: 'wallNode', id: node.id, levelId: ctx.level.id },
        });
    });

    it('snaps to a vertex of a Zone or the Outline', () => {
        expect(snap([12.1, 0.9], context())).toMatchObject({ point: [12, 1], kind: 'vertex' });
        expect(snap([19.85, 9.9], context())).toMatchObject({ point: [20, 10], kind: 'vertex' });
    });

    it('snaps onto a Wall when near its centre-line but not near a node', () => {
        const result = snap([4.3, 5.2], context({ grid: { step: 1, snap: false } }));

        expect(result.kind).toBe('edge');
        expectPoint(result.point, [4.3, 5]);
    });

    it('falls back to the grid', () => {
        expect(snap([6.4, 2.6], context())).toEqual({ point: [6, 3], kind: 'grid' });
        expect(snap([6.4, 2.6], context({ grid: { step: 0.5, snap: true } }))).toEqual({
            point: [6.5, 2.5],
            kind: 'grid',
        });
    });

    it('snaps the direction from an anchor to 15° steps when the grid is off', () => {
        const anchor: Vec2 = [2, 2];
        const raw: Vec2 = [
            2 + 4 * Math.cos((13 * Math.PI) / 180),
            2 + 4 * Math.sin((13 * Math.PI) / 180),
        ];

        const result = snap(raw, context({ grid: { step: 1, snap: false }, anchor }));

        expect(result.kind).toBe('angle');
        expectPoint(result.point, [2 + 4 * Math.cos(Math.PI / 12), 2 + 4 * Math.sin(Math.PI / 12)]);
    });

    it('ignores excluded Wall Nodes, e.g. the one being dragged', () => {
        const ctx = context();
        const node = ctx.level.wallNodes.find((n) => n.position[0] === 10)!;

        const result = snap([10.2, 5.1], { ...ctx, exclude: new Set([node.id]) });

        expect(result.kind).not.toBe('node');
    });

    it('returns the raw point when bypassed (Alt held) or when nothing applies', () => {
        expect(snap([10.2, 5.1], context({ bypass: true }))).toEqual({
            point: [10.2, 5.1],
            kind: 'none',
        });
        expect(snap([6.4, 2.6], context({ grid: { step: 1, snap: false } }))).toEqual({
            point: [6.4, 2.6],
            kind: 'none',
        });
    });
});
