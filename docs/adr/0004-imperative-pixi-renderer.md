# render-2d uses imperative PixiJS, not @pixi/react

`render-2d` drives PixiJS v8 imperatively (`mount` / `update(doc, previous)`) and redraws only Levels and Elements whose object reference changed (ADR-0005); React owns only the UI around the canvas, via a thin wrapper component in `editor`. Declarative `@pixi/react` (used in an early sketch of a future 2.5D viewer) was rejected for the plan layer because reconciling thousands of Zones through React on every edit is too slow, and because the renderer must stay framework-free so non-React hosts can embed it.

Performance target: 5,000 Zones and 10,000 Walls on one Level at 60 fps pan/zoom on a mid-range laptop, with a single edit committed in under 16 ms. Level-of-detail is part of the design: fine detail (labels, Openings, small Obstacles) is drawn only above a zoom threshold.
