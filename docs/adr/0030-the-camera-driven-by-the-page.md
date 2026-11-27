---
status: accepted
---

# The camera driven by the page

Until now the camera moved by the visitor's hand or on its own (`motion`, [ADR-0025](0025-camera-motion-viewpoints-and-cooperative-gestures.md)), and a host page could only choose the Level. Pages that tell a story as they scroll (scroll triggers) and apps that point at what their own list is about need to move it themselves. Decided with the owner in a design interview on 2026-11-26, built on 2026-11-27, and in npm 0.2.0.

**The methods are the View's**, in `@areaform/view`, so React (`ref` on `<AreaformView>` and `<Areaform3DView>`), Vue (the View kept in a ref) and plain TypeScript reach the same thing. On a client's site `embed.js` puts them on the snippet's element as `element.areaform`, once the View is made; the docs say to wait for `areaform:ready`.

- `flyTo(viewpointId | { position, target, levelId? }, { seconds }?)` returns a Promise. It resolves `{ interrupted: false }` on arrival and `{ interrupted: true }` when something took the camera on the way. A Promise lets a story chain its steps with `await`. An `interrupted` flag rather than a rejection keeps a visitor's drag from showing up as an error in the page's console. An id the plan does not have rejects: that is the developer's mistake, and it should be loud.
- `lookAt(zoneId | [x, y], { distance }?)` turns the camera to its target and moves it in a straight line along its line of sight, not in an arc. The plan said the camera stays put. Built that way, an office seen from across the building stayed a speck, so the owner decided on 2026-11-27 that it should come closer. A Zone ends up between 40 % and 80 % of the view's shorter side (`ZONE_SHARE`): a smaller one brings the camera closer, a bigger one sends it back, and one in between, like a point, keeps the distance. `distance` (metres from the camera to the target) sets where it ends.
- `setProgress(t)` places the camera along the shown Level's Viewpoints in tour order. Each leg is an equal share of `t` and eased as a tour flies it, so a scroll settles on each Viewpoint rather than gliding past. It covers one Level only: across Levels there is no path to scrub, and a story goes to another floor in its next part with `setLevel`. It has no flight and sends no events, because a scroll library calls it every frame.
- `setLevel`, `getLevelId` (`getLevel` on the element) and `getCamera`.
- **Ids only.** Names repeat, change and differ between Content Languages ([ADR-0011](0011-content-languages-in-the-document.md)). The Editor makes ids easy to get: **Copy** on each Viewpoint gives `el.areaform.flyTo('vp_…'); // name`. A sidebar section of its own, **For your page**, gives the rest as ready lines: the Level shown, the Zone selected, a point picked in 2D, and **Copy camera** in 3D. The owner chose a section of its own over a coordinate readout on 2026-11-27, so everything a page needs is in one place. The point is picked with the Here tool ([ADR-0017](0017-wayfinding-inside-one-space.md)), which for a page takes any point, outside the building too.
- **A camera is in the 3D view's coordinates**, the `Camera3D` that `camera3dChange` and the `camera3d` option already use. A third convention would be one too many. People get a camera by copying one, not by writing it.

**Another Level is shown first**, as the Level switcher shows it, and the flight starts from there. There is no new animation between floors.

**In 2D the methods pan and zoom.** The plan centres on what a Viewpoint looks at, as wide across as the 3D camera sees at its distance. `lookAt` zooms by the same 40–80 % rule, and `distance` becomes the zoom that shows as much as a 3D camera that far away. Nothing switches the visitor to 3D: the page asked to show a place, not to change the view they chose. `getCamera` in 2D gives a camera straight above the plan's middle at the height of its zoom, so `flyTo(getCamera())` comes back to it in either view.

**The visitor wins.** A drag, a zoom, a tap or a key inside the plan ends the page's flight where it is, and the page's next call takes the camera again. The renderer also ends a flight on its own controls' first move, on another flight, a tour, `setCamera`, another Level or a view preset. A page call stops the camera's own motion as a touch does, so a tour never fights the page. Under `prefers-reduced-motion` the camera is there at once.

**The flight is the 3D renderer's** (`Renderer3D.flyTo` and `stopFlight`). It flies in orbit terms, as the tour does, so it arcs over the plan rather than through Walls (`flightAt` in `tour.ts`, pure and tested). The View animates 2D itself with `requestAnimationFrame`; it is only a centre and a zoom.

**Events:** `on(event, fn)` returns its own unsubscribe, and on the snippet's element each event is also a bubbling DOM event with the same `areaform:` prefix as `areaform:ready`:

| View event    | On the element | Tells                                                                               |
| ------------- | -------------- | ----------------------------------------------------------------------------------- |
| `levelChange` | `levelchange`  | `{ levelId }` on the element: from any cause, the page, the switcher, a route       |
| `viewpoint`   | `viewpoint`    | `{ id, levelId }`: a `flyTo` arrived; `id` null for a camera                        |
| `zoneClick`   | `zoneclick`    | `{ id, levelId, data }`, in 2D or 3D                                                |
| `tourStep`    | `tourstep`     | `{ id, levelId, index }`: the tour stays at a Viewpoint (`Renderer3D`'s `tourStep`) |

The element's names are lower case, as DOM events are. The View's keep the camelCase of its other events.

**No `camera` event each frame** while a page flies the camera. A public event fired every frame is hard to change later, and `camera3dChange` already reports every move to those who use the packages. It waits until someone asks.

**The example** is `/examples/lettera-house/story/`: Lettera House's letting story, with the plan sticky beside the parts. A switch picks stepping (`flyTo`, `lookAt` or `setLevel`, once per part) or scrubbing (`setProgress` following the middle of the screen, then `setLevel` for the car park). It is one HTML file, public in the mirror with the other examples, and listed under **For developers** on `/examples/`.

## Considered

- **Names as well as ids.** Rejected for the reasons above. Copy in the Editor makes ids cheap.
- **`setProgress` across Levels.** Rejected: a Level change is a cut, not a path, and scrubbing back and forth through it would flash floors.
- **Switching to 3D for a flight.** Rejected: the visitor or the owner chose the view.
- **Rejecting the Promise when interrupted.** Rejected: an interruption is normal, and a rejection would show up as an uncaught error wherever a page does not catch it.
