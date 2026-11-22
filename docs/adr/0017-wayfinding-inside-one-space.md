---
status: accepted
---

# Wayfinding inside one Space: computed in the browser, on by default

Visitors ask "where is X and how do I get there" on every kind of plan, so Wayfinding is a default part of a published Space, not an extra. Decided 2026-11-01.

**Code and licence.** A new MIT package, `@areaform/wayfinding`, builds the walkable area from a Document and searches it. The Wayfinding Plugin lives in `@areaform/view`. Both run in the visitor's browser: no server and no cost per request. Only routes between Spaces and along streets stay closed and on our servers (ADR-0009).

**Slices.** Each one ships on its own:

1. One Level: Here, the route line, the Editor's reachability Diagnostic.
2. Across Levels, through Connections and their Stops.
3. A step-free route.

**The walkable area.** The Level's Outline, minus its holes, Walls (with their thickness), Obstacles and Walk-around Zones, with each Opening cut back through its Wall. It is shrunk by a clearance of about 0.3 m so routes keep off corners. An Outline without Walls is open floor. The search runs on a navmesh: the area is triangulated, A* runs over the triangles and a funnel straightens the result. We use a library for polygon clipping and constrained triangulation, and write A* and the funnel ourselves. The mesh is built in the Plugin's lazy chunk, once per Level, the first time it is needed; nothing is added to a Revision.

**Walk-around Zones.** A Zone gets `walkAround?: boolean`, following the pattern of `restricted`: the Preset sets it for a category when a Zone is created (`booth`, `bay`, `stall`), and the Editor shows a checkbox, **Visitors walk around it**, which applies to every selected Zone. The flag is additive, so there is no `schemaVersion` bump. A Walk-around Zone can still be a destination: the route ends at its nearest reachable edge.

**Here.** The visitor's start point. It is set by:

- a tap on the plan, or a Zone picked from a list ("Where are you?"), remembered for the session;
- `?here=<zoneId>` (the Zone's entrance, else its centre), which stays valid when the plan is redrawn, so it suits printed QR codes;
- `?here=<levelId>:<x>,<y>`, for a kiosk in an open hall;
- `data-here` on the `embed.js` snippet, which takes the same two forms.

The View opens on Here's Level, so a QR code on the gallery shows the gallery, over any Level the host gave. A Here that names no Level or Zone of the plan, or a spot outside the building, is left out, and the View opens on the ground floor (the Level at elevation 0, else the lowest).

Points the author places in the Editor ("Entrance A") wait for the kiosk check ([`kiosk.md`](../notes/kiosk.md)).

**The visitor's flow.** Tapping a Zone opens the tooltip card, and the Wayfinding Plugin adds **Directions** to it. Tapping open floor offers **Directions to here**. Without Here, the Plugin asks "Where are you?" first. A Here or destination that is not walkable (a Wall, an Obstacle, a Walk-around Zone) snaps to the nearest walkable point. Outside the Level's Outline is different, since visitors can't walk through a Wall. **Here** is never outside: a tap there sets nothing and says "Pick a spot inside the building", the Editor's Here picker refuses such points, and a `?here=` outside, from an old link, is left out so the Plugin asks again. **A destination** tapped outside an upper Level's Outline is first looked for on the nearest Level below whose Outline holds it (beside a gallery, under an atrium), and is an ordinary destination there. Outside every such Outline it is outside the building: the route ends in the doorway of a way out on any Level (an Opening with the Outline on one side and the outside on the other, never an emergency exit) whose walk, rides and way on to the place are shortest. The way on (`wayOutside`) goes straight out of the door, then the shortest way round the building that stays outside the Outline of the door's Level, about 1 m off it, cutting each corner; a door it cannot reach the place from (a courtyard from the street, or the other way) is no way out to it. A dotted line, thinner and still, shows it from the door to the pin at the place; it is not counted in the length or the time, since what lies outside (roads, fences) is not drawn. With no way out that reaches the place, the tap is refused with the same note. In 3D the route and the dotted line are drawn in the scene (`Renderer3D.setLines`), on the floor, so a Wall or an Obstacle in front of them hides them; they keep the 2D colours and widths, but their dashes are still. The pins and the Level-change markers stay over the scene, so they are never lost; one behind a Wall or an Obstacle (`Renderer3D.isHidden`) fades, to show it is behind. The place card does not fade. In 2D, when a route is drawn or its Level is shown, the Plugin moves the plan so the route on that Level, its pins and the dotted line are in view above the route panel. It pans, and zooms out only when they do not fit, so the panel never hides the end of a route by the bottom of the plan. `placeOf` in `@areaform/wayfinding/place` tells these apart without the navmesh, so the Plugin and the Editor use it at a tap. In slice 1, a Here and destination on different Levels show the pin and the message "Routes between Levels are coming" instead of drawing nothing.

**What is drawn.** A "You are here" pin and a destination pin, and a **dashed** route line, so it reads as a way and not a Wall. The line is in the accent colour with rounded dashes, a fixed width in screen pixels, above Zones and below labels. Its dashes move slowly toward the destination, and stay still under `prefers-reduced-motion`. In 3D it is the same line, just above the floor. A small panel shows the distance, the walking time (at about 1.2 m/s), **Change start** and a clear button, or "No route found". Turn-by-turn text waits for slice 2.

**On by default.** `embed.js` loads the Plugin for every published Space. Publish settings have a switch to turn it off, saved in the manifest's Plugins list (ADR-0015). This is the first per-Space Plugin setting. In `createView` and `<AreaformView>` it stays a Plugin the host passes (`plugins: [wayfinding]`), so the View's base stays small (ADR-0012).

**The Editor's Diagnostic.** The Editor runs the same mesh and reports a Zone that cannot be reached, for example "Hall B can't be reached: no Opening in its Walls". This catches missing doors before visitors do. It lands in slice 1, after the Plugin works.

**Libraries** (compared 2026-11-01, on a sample hall and on randomly generated messy plans with rotated, near-touching blockers):

- **`@areaform/wayfinding` uses three libraries.** `@countertype/clipper2-ts` (BSL-1.0, about 25 KB gzipped) builds the walkable area and shrinks it by the clearance. `delaunator` (ISC) with `@kninnug/constrainautor` (ISC), about 7 KB together, triangulate it. All of it is in the Plugin's lazy chunk, never in the `embed.js` loader.
- **Why Clipper2.** It works on integer coordinates (we use millimetres), and it was the only clipper with no failures on the messy plans: 0 in 210, at 16 ms for 400 blockers. `polygon-clipping` threw on a third of them and has no offset. `clipper2-js` shrank wrongly, dropping holes.
- **The risk with Clipper2.** The TypeScript port has one maintainer, so we pin its exact version, keep the messy-plan tests as regression tests, and copy its source into the repo if it is abandoned (BSL-1.0 allows that). BSL-1.0 asks for its licence text in source copies, so the package ships a `THIRD-PARTY-NOTICES` file.
- **Our own cleaning step.** After the shrink, two rings can touch along a line. Every triangulator tried, `cdt2d` and `poly2tri` included, failed on that until edges were split at the corners lying on them. That cleaning step is ours, in exact integer arithmetic. `cdt2d` was 5× slower and has not changed in years; `poly2tri` cannot take touching rings at all.

## Considered Options

- **Routing on our server.** It would cost per request, add an outage path, and break the promise that a Document can be shown anywhere with the MIT packages.
- **Graph precomputed at Publish and stored in the Revision.** It would make the Revision format bigger and add another cached file. We keep this for later, behind the same Plugin interface, if big plans turn out slow.
- **A visibility graph or a grid** instead of a navmesh. A visibility graph is slow with many booths; a grid gives zig-zag routes whose accuracy depends on the cell size.
- **Every Zone walkable.** This would send routes across other exhibitors' stands.
- **Exclusive Categories block movement.** This needs no new field, but rooms are Exclusive too and must be entered, and the owner could not change it per Zone.
- **A per-category setting stored in the Document** (`categories: { booth: { walkAround: true } }`). One switch would change every booth, but categories would become a stored entity for the first time. Multi-select gives the same result today.
- **Opt-in Wayfinding.** It is used on nearly every plan; the off switch and the Editor's Diagnostic cover plans drawn without doors.

## Consequences

- `@areaform/wayfinding` is a new open package; it moves to the public repository with the others. The BUSL Editor imports it for the Diagnostic.
- The tooltip card gets a small extension point so another Plugin can add a button to it.
- The manifest's Plugins list gains its first per-Space setting, and the web app gets a switch in Publish settings.
- A Zone's `walkAround` goes into the model, the schema, `zone.update`, the Presets, the brief's Document model and the MCP Command reference.

## Update 2026-11-01: the place card, and the line over the labels

Building the Plugin in 2D changed two things decided above:

- **Directions is on a place card of the Plugin's own, not on the tooltip card.** The tooltip card follows the pointer and hides when it leaves the Element, so a button on it cannot be clicked, and a touch screen never shows it. A tap on a Zone, or on open floor, now opens a card that stays where it was opened, with **Directions** (or **Directions to here**); the tooltip card is unchanged and needs no extension point.
- **The route line is drawn over the plan in an SVG layer, so it lies above Zone labels, not below them.** It is positioned with `view.toScreen` and redrawn on `camera2dChange`, a new View event for any 2D pan, zoom or resize. A light edge under the dashes keeps both readable. Drawing it under the labels would take a new layer in the Pixi renderer; that waits until it is seen to matter. The same SVG layer can draw the line in 3D.
- **In 3D the line is the same SVG layer**, projected just above the floor. It is not hidden by a Wall standing between it and the camera; the cutaway lowers the near Walls, so this shows only from low angles. Hiding it there would need the line in the Three.js scene.

## Update 2026-11-01: the Editor's Problems list

The Editor showed no Diagnostics at all; only the playground listed them, as codes. So the unreachable-Zone check comes with a **Problems** list at the top of the Editor's sidebar, shown while there are any: every Diagnostic in plain words in the interface language, and the Zones visitors cannot reach; a click selects the Element on its Level. The web app and every host get it (`problems={false}` turns it off).

- **Where visitors arrive** on a Level: inside each Opening in its outer edge (entrances and doors to the outside; emergency exits are not a way in), and beside each Stop of a Connection. A Level with neither counts its largest piece of floor.
- **A Zone is reached** when floor connected to an arrival comes within the clearance of it: a room through its door, a booth from the aisle beside it. Restricted Zones are checked too.
- **Cost.** With the navmesh built, checking 5,000 booths takes about 50 ms, using a grid of floor triangles. The Editor checks 0.8 s after the last change and only redoes Levels whose data changed.

## Update 2026-11-01: `embed.js` and Publish settings

- **The manifest's `plugins`** lists the Plugins `embed.js` starts, today `["wayfinding"]` or `[]`. The server keeps the owner's switches per Space (`space.plugins`, where a Plugin left out has its default, so a new Plugin can arrive on or off) and writes the list on Publish and on each change of a published Space. A manifest written before has no list, and `embed.js` starts its defaults.
- **Here on a client's page** comes from `data-here` on the snippet's element (a kiosk), else `?here=` in the page's address (a QR code). A value naming nothing in the plan is ignored, so one `?here=` can serve a page with several plans.
- **Publish settings are a For visitors section of the Publish dialog,** saved as they change: **Directions** (Wayfinding) and **Page with the plan**. The page's address was not planned: without it the web app could give the Editor's Here value but no link, because the plan lives on the client's own page. With it, the Editor's **Copy link** gives that page with `?here=`.

## Update 2026-11-01: the way between Levels (slice 2)

- **One search over the Space.** `findSpaceRoute` in `@areaform/wayfinding` runs Dijkstra over Here, the place and every Stop, walking on each Level's navmesh (walks found as they are needed) and riding Connections between Stops. It weighs time: walking at 1.2 m/s, a lift a 30 s wait plus 1.5 m/s, stairs 5 s, an escalator 4 s and a ramp 12 s per metre climbed. The height comes from the Levels' elevations, else 4 m a storey. The Plugin builds the navmeshes of the Levels with a Stop, Here or the place, once each.
- **Getting on and off** is at the floor beside a Stop's entry point, else its middle. Stops still block walking. A lift with doors on one side should have its entry point set, or the route may come to its back.
- **A one-way Connection runs from its first Stop to its last.** The model had no direction. The Stops' order gives one with no new field and no `schemaVersion` bump. The Editor shows it for a one-way Connection, "Level 1 → Gallery", with **Reverse**. An escalator drawn in the Editor runs from the Level it is drawn on to the one above (below, on the top Level).
- **What visitors see.** A route is shown from its start, a Level at a time: the line of that Level's part; on the plan a button where the route changes Level (**↓ Level 1**) and one where it arrives (**From Gallery**), each going to the other Level; the panel's steps ("Take Main stairs down to Level 1"), each going to the Level where it starts. The time counts the rides. "Routes between Levels are coming" is gone.
- **Turn-by-turn text is left out.** The plan put it in this slice. "Turn left" needs the visitor's heading, which a plan does not know, and the funnel's many small bends would read as noise. The Level steps say what a plan cannot show. Directions such as "past the Café" can follow if visitors ask for them.

## Update 2026-11-01: the step-free route (slice 3)

- **`accessible` on a Connection decides it.** A step-free route takes only Connections marked accessible; a Level's own floor needs nothing. The flag was in the model and the Editor already, but nothing used it.
- **Lifts and ramps start marked.** The Editor marks a new lift or ramp accessible, and so does a change of kind to one; stairs and escalators start unmarked. This follows the pattern of `walkAround` from the Presets. The owner unticks a lift too small for a wheelchair, or ticks stairs with a stair lift. Lifts and ramps drawn before this are unmarked and need ticking. The sample's lift was already marked.
- **Visitors switch it** with **Step-free** in the route panel, shown when the Space has Connections. Without a step-free way, the panel says "No step-free route found". The Plugin's `stepFree` option starts with it on.
- **Left out:** doors too narrow for a wheelchair, a wider clearance for one, and the Problems list warning when a Level has no step-free way to it. All three can follow if owners ask. `embed.js` has no `data-step-free`; visitors switch it themselves.

## Update 2026-11-01: the shortest way, by Polyanya

A* between the midpoints of triangle edges, then the funnel, sometimes went round an obstacle the long way. Checked against the exact shortest path (a visibility graph over the floor's corners) on random halls, 31 of 160 routes were over 1% longer, the worst by 47%. Between Levels, this could also pick the wrong Connection.

- **The exact search is [Polyanya](https://ojs.aaai.org/index.php/ICAPS/article/view/13861)** (Cui, Harabor and Grastien, 2017), written in `route.ts`. It searches intervals of triangle edges seen from a root, the last corner the path turned at, and turns only at corners sticking into the floor. It gives the true shortest path, so the funnel is no longer needed for it. On the random halls, no route is now over 1% longer; the check is a regression test.
- **The quick route comes first.** On a dense hall, an exact long route can take a long time: about 1.4 s for 340 m across the 5,000-booth stress plan, as every booth corner sees far along the aisles. So the corridor search runs first, now crossing each edge where a path heading for the goal would, rather than at its midpoint. Polyanya then looks only for something shorter, and stops after 20,000 steps (about 60 ms). On ordinary plans it finishes, so routes are exact. On the stress plan a long route may keep the quick result. In 14 sampled routes it stayed within about 1% of the exact one, where the old search was up to 5.5% longer. The quick result has no bound in theory; the benchmark's corner-to-corner route is 562.7 m (was 571.7 m) in about 150 ms (was 28 ms).
