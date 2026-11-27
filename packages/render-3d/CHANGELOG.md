# @areaform/render-3d

## 0.2.0

### Minor Changes

- The page drives the plan's camera ([ADR-0030](https://github.com/areaform/areaform/blob/main/docs/adr/0030-the-camera-driven-by-the-page.md)).

    - **The View** (view): `flyTo(viewpointId | camera, { seconds })`, a Promise of `{ interrupted }`; `lookAt(zoneId | [x, y], { seconds, distance })`, which turns the camera and brings it closer to a small Zone or sends it back from one too big (`ZONE_SHARE`, 40–80 % of the view's shorter side); `setProgress(t)` along the shown Level's Viewpoints, for scroll-driven pages; and `getCamera()`. A Viewpoint or Zone on another Level shows that Level first; in 2D the plan pans and zooms instead; the visitor's touch stops what the page started; under `prefers-reduced-motion` the camera jumps. New events: `viewpoint`, `zoneClick` and `tourStep`; `levelChange` is also sent when an update takes away the Level shown. `<AreaformView>` and `<Areaform3DView>` give the View through `ref` and take `onViewpoint`, `onZoneClick` and `onTourStep`. `CameraTarget`, `FlightResult`, `FlyToOptions`, `LookAtOptions` and `ZONE_SHARE` are exported.
    - **The 3D renderer** (render-3d): `flyTo(camera, { seconds, path })` and `stopFlight()`, a flight ended by the visitor's drag or zoom, another flight, a tour, `setCamera`, another Level or a view preset; a `tourStep` event when a tour stays at a Viewpoint. `poseAlong`, `flightAt`, `ease` and the `FlightPath` and `FlightOptions` types are exported.
    - **The Editor** (editor): **Copy** on each Viewpoint gives a ready `flyTo` line, and a new sidebar section, **For your page** (`page` in `foldedSections`, folded at first), gives the `setLevel` line for the Level shown, the `lookAt` line for the Zone selected, **Pick a point…** for `lookAt([x, y])`, and **Copy camera** in 3D. `startHerePick('page')` picks any point, outside the building too.

### Patch Changes

- @areaform/core@0.2.0
    - @areaform/render-2d@0.2.0

## 0.1.0

### Minor Changes

- First public release. A 3D view of a Level with Three.js, loaded on first use: Walls with door gaps and lintels, Zones, Obstacles, Stops, labels on the floor, orbit, pan and zoom, and camera tours through the Level's Viewpoints.
