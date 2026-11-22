// Timing on the 5,000-booth stress plan, every booth Walk-around: `pnpm --filter @areaform/wayfinding bench`.
import { stressSpace } from '@areaform/core/testing';
import { buildNavMesh, findRoute, unreachableZonesOn } from '../src/index.ts';

const doc = stressSpace({ booths: 5000, walls: 200 });
const level = doc.levels[0]!;
for (const zone of level.zones) zone.walkAround = true;
const xs = level.outline.outer.map((p) => p[0]);
const ys = level.outline.outer.map((p) => p[1]);

let t = performance.now();
const mesh = buildNavMesh(doc, level.id);
const built = performance.now() - t;
t = performance.now();
const route = findRoute(
    mesh,
    [Math.min(...xs) + 1, Math.min(...ys) + 1],
    [Math.max(...xs) - 1, Math.max(...ys) - 1],
);
const routed = performance.now() - t;

console.log(`navmesh: ${mesh.triangles.length / 3} triangles in ${built.toFixed(0)} ms`);
console.log(
    `route corner to corner: ${route ? `${route.length.toFixed(1)} m, ${route.points.length} points` : 'none'} in ${routed.toFixed(1)} ms`,
);

t = performance.now();
const unreachable = unreachableZonesOn(doc, level, {}, mesh);
console.log(
    `unreachable Zones check (navmesh reused): ${unreachable.length} of ${level.zones.length} in ${(performance.now() - t).toFixed(0)} ms`,
);
