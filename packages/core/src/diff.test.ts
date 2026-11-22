import { describe, expect, it } from 'vitest';
import {
    createEditor,
    createSpace,
    diff,
    fromJSON,
    toJSON,
    type Command,
    type ElementRef,
    type Ring,
} from './index.ts';

const square = (x: number, y: number, size: number): Ring => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
];

/** An office Space with one booth and one Wall; `run` applies Commands and returns before/after. */
function office() {
    const editor = createEditor(createSpace({ name: 'Office', kind: 'office', size: [20, 10] }));
    const G = editor.getDocument().levels[0]!.id;
    const exec = (command: Command) => {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
    };
    exec({ type: 'zone.add', levelId: G, zone: { id: 'Z', shape: { outer: square(1, 1, 2) } } });
    exec({ type: 'wall.add', levelId: G, id: 'W', a: [0, 5], b: [10, 5], thickness: 0.1 });
    const run = (...commands: Command[]) => {
        const before = editor.getDocument();
        commands.forEach(exec);
        return { before, after: editor.getDocument() };
    };
    return { editor, G, run };
}

const refsOf = (items: { ref: ElementRef }[]) => items.map((i) => `${i.ref.kind}:${i.ref.id}`);
const ids = (refs: ElementRef[]) => refs.map((r) => `${r.kind}:${r.id}`);

describe('diff', () => {
    it('finds nothing between a Document and itself, or a copy loaded from JSON', () => {
        const { editor } = office();
        const doc = editor.getDocument();
        const loaded = fromJSON(toJSON(doc));
        if (!loaded.ok) throw new Error('load failed');

        const empty = { added: [], updated: [], removed: [] };
        expect(diff(doc, doc)).toEqual(empty);
        expect(diff(doc, loaded.doc)).toEqual(empty);
    });

    it('lists added, changed and removed Elements with their Level', () => {
        const { G, run } = office();
        const { before, after } = run(
            { type: 'zone.update', levelId: G, zoneId: 'Z', changes: { label: 'A-1' } },
            {
                type: 'obstacle.add',
                levelId: G,
                obstacle: { id: 'O', shape: { outer: square(5, 1, 1) }, kind: 'column' },
            },
            { type: 'wall.delete', levelId: G, wallId: 'W' },
        );

        const changes = diff(before, after);

        expect(changes.added).toEqual([
            {
                ref: { kind: 'obstacle', id: 'O', levelId: G },
                value: after.levels[0]!.obstacles[0],
            },
        ]);
        expect(changes.updated).toEqual([
            { ref: { kind: 'zone', id: 'Z', levelId: G }, value: after.levels[0]!.zones[0] },
        ]);
        // The Wall and the Wall Nodes it no longer needs.
        expect(ids(changes.removed).sort()).toEqual(
            ['wall:W', ...before.levels[0]!.wallNodes.map((n) => `wallNode:${n.id}`)].sort(),
        );
        expect(changes.document).toBeUndefined();
    });

    it('reports a Wall split by a new one as changed, with the new pieces added', () => {
        const { G, run } = office();
        const { before, after } = run({
            type: 'wall.add',
            levelId: G,
            id: 'T',
            a: [4, 5],
            b: [4, 9],
            thickness: 0.1,
        });

        const changes = diff(before, after);

        expect(refsOf(changes.updated)).toEqual(['wall:W']);
        const added = refsOf(changes.added);
        expect(added).toContain('wall:T');
        expect(added.filter((r) => r.startsWith('wall:'))).toHaveLength(2); // T and W's tail
        expect(added.filter((r) => r.startsWith('wallNode:'))).toHaveLength(2);
    });

    it("gives a Level's own properties without its Element lists", () => {
        const { G, run } = office();
        const { before, after } = run({
            type: 'level.update',
            levelId: G,
            changes: { name: 'Ground floor' },
        });

        const changes = diff(before, after);

        expect(changes.updated).toHaveLength(1);
        expect(changes.updated[0]!.ref).toEqual({ kind: 'level', id: G });
        expect(changes.updated[0]!.value).toMatchObject({ name: 'Ground floor', ordinal: 0 });
        expect(changes.updated[0]!.value).not.toHaveProperty('zones');
    });

    it('adds a duplicated Level before its Elements, and removes a Level after them', () => {
        const { G, run } = office();
        const { before, after } = run({ type: 'level.duplicate', levelId: G, id: 'L2' });

        const added = refsOf(diff(before, after).added);
        expect(added[0]).toBe('level:L2');
        expect(added).toContain('zone:' + after.levels.find((l) => l.id === 'L2')!.zones[0]!.id);

        const removed = ids(diff(after, before).removed);
        expect(removed.at(-1)).toBe('level:L2');
        expect(removed).toHaveLength(added.length);
    });

    it('tracks Connections as a whole, Stops included', () => {
        const { G, run } = office();
        const first = run(
            { type: 'level.add', id: 'L2', name: 'Level 2' },
            {
                type: 'connection.add',
                connection: {
                    id: 'S',
                    kind: 'stairs',
                    bidirectional: true,
                    stops: [
                        { levelId: G, shape: { outer: square(8, 1, 2) } },
                        { levelId: 'L2', shape: { outer: square(8, 1, 2) } },
                    ],
                },
            },
        );
        expect(refsOf(diff(first.before, first.after).added)).toEqual(['level:L2', 'connection:S']);

        const second = run({
            type: 'connection.update',
            connectionId: 'S',
            changes: { name: 'A' },
        });
        expect(diff(second.before, second.after).updated).toEqual([
            { ref: { kind: 'connection', id: 'S' }, value: second.after.connections[0] },
        ]);

        const third = run({ type: 'connection.delete', connectionId: 'S' });
        expect(diff(third.before, third.after).removed).toEqual([{ kind: 'connection', id: 'S' }]);
    });

    it("gives the Space's own properties when they change", () => {
        const { editor } = office();
        const before = editor.getDocument();
        const after = { ...before, name: 'Head office', grid: { step: 0.5, snap: true } };

        const { document } = diff(before, after);

        expect(document).toMatchObject({ name: 'Head office', grid: { step: 0.5, snap: true } });
        expect(document).not.toHaveProperty('levels');
    });
});
