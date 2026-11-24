// Run: node packages/core/bench/run.ts
import { checkInvariants } from '../src/checks/invariants.ts';
import { createEditor, diagnose, fromJSON, toJSON, zoneAt } from '../src/index.ts';
import { stressSpace } from './stressSpace.ts';

function time(label: string, runs: number, fn: () => void) {
    fn(); // warm-up
    const start = performance.now();
    for (let i = 0; i < runs; i++) fn();
    const ms = (performance.now() - start) / runs;
    console.log(`${label.padEnd(44)} ${ms.toFixed(2).padStart(8)} ms`);
}

const doc = stressSpace({ booths: 5000, walls: 10000 });
const levelId = doc.levels[0]!.id;
const level = doc.levels[0]!;
console.log(`Stress Space: ${level.zones.length} Zones, ${level.walls.length} Walls\n`);

const errors = checkInvariants(doc);
if (errors.length)
    throw new Error(`stress Space is invalid: ${JSON.stringify(errors.slice(0, 3))}`);

time('checkInvariants (whole Document)', 20, () => checkInvariants(doc));

const editor = createEditor(doc);
let n = 0;
time('exec zone.update (label)', 20, () => {
    editor.exec({
        type: 'zone.update',
        levelId,
        zoneId: 'booth-42',
        changes: { label: `L${n++}` },
    });
});
time('exec wall.add (crossing nothing)', 20, () => {
    editor.exec({
        type: 'wall.add',
        levelId,
        a: [1, 1 + (n % 3) * 0.1],
        b: [2, 2],
        thickness: 0.1,
    });
    n++;
});
time('preview level.delete-like (zone.delete)', 20, () => {
    editor.preview({ type: 'zone.delete', levelId, zoneId: 'booth-7' });
});
time('diagnose', 5, () => diagnose(doc));
time('zoneAt (hover)', 200, () => zoneAt(level, [101, 101]));
const json = toJSON(doc);
time('toJSON', 10, () => toJSON(doc));
time('fromJSON', 10, () => fromJSON(json));
console.log(`\nJSON size: ${(json.length / 1024 / 1024).toFixed(1)} MB`);
