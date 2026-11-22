# @areaform/wayfinding

Walking routes inside one Space: the walkable area of a Level, its navmesh, the shortest route between two points on it, and the quickest route between Levels through stairs, lifts, escalators and ramps. Runs in the browser; no server ([ADR-0017](../../docs/adr/0017-wayfinding-inside-one-space.md)).

```ts
import { buildNavMesh, findRoute } from '@areaform/wayfinding';

const mesh = buildNavMesh(doc, levelId); // once per Level
const route = findRoute(mesh, [2, 3], [40, 18]);
// { points, length, from, to }: the corners it turns at and its length in metres, or null
```

- **The walkable area** is the Level's Outline minus its Walls, Obstacles, Walk-around Zones (`walkAround: true`) and Connection Stops, with each Opening hosted on a Wall cut through it, kept `clearance` (0.3 m by default) away from all of them. A door narrower than twice the clearance stays passable.
- **Routes are the shortest way**, by [Polyanya](https://ojs.aaai.org/index.php/ICAPS/article/view/13861), after a quick corridor search; on a huge, dense plan a long route may stop at the quick one (see ADR-0017).
- **`findRoute`** moves a start off the floor (a tap on a Wall) to the nearest point on it, and an end off the floor (inside a booth) to the nearest point the start can reach, so a route to a booth ends at its edge. It is `null` when the end is on floor the start cannot reach, such as a room with no way in.
- **`findSpaceRoute(doc, from, to, meshOf)`** finds the quickest route between two points on any Levels, as `legs`: the part walked on each Level, each ending at the Connection taken (`ride`: which, up or down, to which Level, how long). It walks at `WALKING_SPEED` (1.2 m/s) and rides as `RIDE_SECONDS` says: a lift waits 30 s, stairs, escalators and ramps cost per metre climbed. A one-way Connection goes only from its first Stop toward its last. Visitors get on and off at the floor beside a Stop's entry point, else its middle. `meshOf(levelId)` gives each Level's navmesh, usually cached `buildNavMesh` results.
- **`placeOf(doc, at)`**, also in the small `@areaform/wayfinding/place` entry (no navmesh code), says where a tapped place is: `inside` on its Level, or on the nearest Level below whose Outline holds it; `outside` the building, with its `exits` (`exitsOf`: Openings leading out, never emergency exits); or `nowhere`, outside with no way out. `findSpaceRoute` follows it: a route to a place outside ends in the best doorway, with the place as `outside` and the `way` on to it: out of the door and round the building, about 1 m off its Outline (`wayOutside`), chosen by its length but not counted in the route's; to `nowhere` it is null. `isInside(doc, at)` tells whether a Here is inside its Level's Outline.

```ts
const route = findSpaceRoute(
    doc,
    { levelId: 'G', point: [2, 3] },
    { levelId: 'L1', point: [9, 4] },
    meshOf,
);
// { legs: [{ levelId: 'G', points, length, ride: { kind: 'stairs', toLevelId: 'L1', up: true, … } },
//          { levelId: 'L1', points, length }], length, seconds, from, to }, or null
```

- **`{ stepFree: true }`**, the last argument, takes only Connections marked `accessible` (`isStepFree`): lifts and ramps, as the Editor marks them when drawn, and anything else the owner marks.

Clipping and the clearance use [Clipper2](https://github.com/countertype/clipper2-ts) on integer millimetres; the triangulation uses [Delaunator](https://github.com/mapbox/delaunator) and [Constrainautor](https://github.com/kninnug/constrainautor). Their licences are in [`THIRD-PARTY-NOTICES`](THIRD-PARTY-NOTICES).

MIT.
