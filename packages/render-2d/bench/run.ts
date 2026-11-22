// Run: node packages/render-2d/bench/run.ts
// Label centres for every Zone of the demo office, per Level: what the first visit to a Level
// costs before its labels are cached. Long, thin Zones once took seconds here.
import { readFileSync } from 'node:fs';
import { fromJSON } from '@areaform/core';
import { visualCenter } from '../src/polylabel.ts';

const file = new URL('../../../apps/server/demo/office.json', import.meta.url);
const result = fromJSON(readFileSync(file, 'utf8'));
if (!result.ok) throw new Error('the demo office does not load');
const { doc } = result;

for (const level of doc.levels) {
    let worst = 0;
    let worstName = '';
    const start = performance.now();
    for (const zone of level.zones) {
        const t = performance.now();
        visualCenter(zone.shape);
        const ms = performance.now() - t;
        if (ms > worst) [worst, worstName] = [ms, zone.label ?? zone.id];
    }
    const total = performance.now() - start;
    console.log(
        `visualCenter, ${level.name} (${level.zones.length} Zones)`.padEnd(44),
        `${total.toFixed(2).padStart(8)} ms   slowest ${worst.toFixed(2)} ms ${worstName}`,
    );
}
