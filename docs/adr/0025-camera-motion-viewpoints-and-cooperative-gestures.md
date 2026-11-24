---
status: accepted
---

# The camera moves on its own, through Viewpoints saved on the Level, and plans let the page scroll

Home's hero is meant to show a live plan, not a video, and the landing site wants its camera to move. A still 3D plan looks like a screenshot, and only movement shows that it is alive. While planning this we found something else: an embedded plan takes the page's scrolling. In 3D the wheel always zooms, and 2D's `WheelMode` only chooses between zooming and panning. A visitor scrolling down any page with a plan on it gets stuck inside the plan. Decided on 2026-11-16, together with bringing the camera tour forward from "an interview and an ADR of its own first" to this change.

## Motion: `none`, `orbit` or `tour`

**A View feature for every client,** off by default and on Free. `motion: 'none' | 'orbit' | 'tour'` on the View, `data-motion` on the snippet, and **Camera in 3D** in the Publish dialog (_Still_, _Turn slowly_, _Tour_), beside **Show the plan first as**. The setting is saved per Space and written to the manifest as `motion`. The snippet's `data-motion` overrides it, as `data-view` does. There is no `?af-motion=` in the page's address, which belongs to the client's site.

- **`orbit`** is a slow turn around the point the camera looks at, about one turn a minute, eased in over a second, at the angle the plan opened with.
- **`tour`** loops through the Viewpoints of the Level that is shown (below). It flies to each one in its `flight` time and stays there for its `pause`, with ease in and out. The flight is interpolated in orbit terms (the target, the bearing the short way round, the tilt and the distance), so the camera arcs over the plan instead of cutting through Walls, and never goes below the floor. A Level with a single Viewpoint flies there and then orbits around it. A Level with none orbits. Switching Level plays that Level's own Viewpoints.
- **3D only.** In 2D the plan stays still. A 2D tour that pans and zooms was considered and left out: from straight above, sliding reads as nervous, and there is no bearing or tilt to use.

**The same rules for both**, owned by the View, not the renderer:

- They start after `ready3d`.
- They stop for good on the first interaction inside the plan: a click or tap, a mouse drag, a pinch, a two-finger gesture, ⌘/Ctrl + wheel, or a key. Under cooperative gestures (below), a plain wheel or a one-finger swipe that scrolls the page is not an interaction. That visitor is scrolling past.
- Choosing what to see is not an interaction either (decided on 2026-11-16, after the first version stopped for good on a floor change). Picking a Level in the Level switcher plays that Level's motion, and switching 2D to 3D plays it once 3D is ready, from the camera as it is. Fit, Top view and Angled view move the camera for the visitor, so they stop it as a drag does. A Level set by code, such as Wayfinding following a route across floors, leaves the motion as it is.
- They pause while the plan is off screen (`IntersectionObserver`) or the tab is hidden, and go on from where they were.
- Under `prefers-reduced-motion` they never move.

**Split across the layers.** render-3d turns and flies the camera (`setOrbit`, and `playTour`, `pauseTour` and `stopTour`, their maths pure and unit-tested in `tour.ts`). The Editor's **Go to** is a tour of one Viewpoint. `@areaform/view` decides when (`motion`, `setMotion`, the rules above). `embed.js` reads the snippet and the manifest. The renderer knows nothing of page visibility or intersection, which belong to the host's side.

## Viewpoints

**A Viewpoint is a camera saved on a Level:** what it looks at, from where, and how long the tour takes to get there and stays. "View" was already taken several times over (the View package, the 2D and 3D views, `data-view`), hence the new word.

```ts
interface Viewpoint {
    id: Id;
    name?: string; // "Entrance A", shown in the Editor's list
    target: Vec2; // plan metres, the point on the floor it looks at
    bearing: number; // degrees, the compass direction it looks towards, 0 = north
    tilt: number; // degrees, 0 = straight down, at most 87 (MAX_VIEWPOINT_TILT)
    distance: number; // metres from the target
    flight?: number; // seconds to fly here, 3 when absent
    pause?: number; // seconds to stay, 2 when absent
}
```

- **Kept on the Level, as `level.viewpoints?`.** The tour plays the Level that is shown, so there is no rule needed for a tour that mixes Levels. Flights between Levels are a later idea. They would move the list to the Document, a small migration.
- **Tilted at most 87°.** The 3D view stops the camera about 87.1° from straight down, just above the floor. The checker takes 0 to 87° (`MAX_VIEWPOINT_TILT` in core), so a saved tilt is always one the camera shows as written, and a camera saved at its lowest is stored at 87°.
- **In plan terms, not the camera's.** The renderer's `Camera3D` is a position and a target in Three.js space (y up, z the plan's −y). A Viewpoint is in plan coordinates ([ADR-0002](0002-y-up-ccw-coordinates.md)) and orbit terms, so a person reading the file, or an AI asked for "booth A12 from the south-east", can write one without 3D trigonometry. render-3d converts both ways, and a test checks the round trip.
- **Optional, so no `schemaVersion` bump** ([ADR-0006](0006-schema-versions-and-migrations.md)). Older readers ignore the field, and older Documents have none. The model, the checker, `toJSON` and the JSON Schema at its address ([ADR-0024](0024-the-json-schema-at-a-permanent-address.md)) change together, and the agreement test holds them to it. The GeoJSON export leaves Viewpoints out.
- **Changed through Commands:** `viewpoint.add`, `viewpoint.update`, `viewpoint.delete` and `viewpoint.move` (its place in the list), each one undo step. Deleting a Level deletes its Viewpoints with it, and duplicating one copies them with ids of their own. A Viewpoint is not checked against the plan: one left looking at nothing after Walls moved is the owner's to fix, and it still flies.
- **Exported with the plan.** A plan shown from the owner's own storage carries its tour.

**In the Editor,** a Viewpoints section in the sidebar while the 3D view is open:

- **Add this viewpoint** saves the camera as it is.
- Each row has its name, **Go to**, **Use this view** (the camera as it is saved in that Viewpoint's place), its flight and pause times, a way to move it up or down, and delete.
- **Play tour** plays it in place, and any interaction stops it.
- In 2D the section lists the Viewpoints with a note to open 3D to add them, and the plan shows each one as a small numbered camera mark.
- Texts in all four UI languages.

**Through the MCP server,** a person can ask for a tour in words ("show the entrance, then the café, then the hall from above"):

- The `viewpoint.*` Commands come through `apply_commands`, like every other Command.
- A new tool, `frame_viewpoint({ levelId, zoneIds | point, bearing, tilt })`, returns a Viewpoint whose distance fits those Zones or that point, using the same pure framing maths as the renderer (`framePose`). The AI never guesses a distance. A point comes with a `radius` to keep in view (5 m by default), and `aspect` is the shape of the view the tour will show in (1.5 by default; the Office's hero tour is framed for 0.8). Where a Viewpoint's camera stands on the plan, `viewpointSpot` in core, is shared with the Editor's marks.
- `render_preview` draws each Viewpoint as a numbered mark with a wedge for where it looks, so the AI and the person can check the tour on the 2D preview. The server cannot draw 3D: headless WebGL in Node is a project of its own.
- The server's instructions gain a short "To make a camera tour" section.

## Cooperative gestures

**`gestures: 'cooperative' | 'greedy'` on the View, in 2D and 3D.** This is the pattern of Google Maps' `gestureHandling: 'cooperative'` and MapLibre's `cooperativeGestures`. Under `cooperative`:

- A plain wheel scrolls the page, and a short hint fades in for about a second and a half with how to zoom and move the plan: "Use ⌘ or Ctrl + scroll to zoom the plan, and drag to move it" (Ctrl alone off a Mac). In 3D, where a plain drag turns the camera, it says "Ctrl + drag to move it".
- ⌘/Ctrl + wheel and a trackpad pinch zoom.
- On touch, one finger scrolls the page and two fingers move the plan, with the hint "Use two fingers to move the plan". In 3D two fingers orbit and pinch. The 2D plan had no pinch at all, so it gained one for every plan, `greedy` too: two fingers pan and zoom.
- Clicks, taps on Zones and hover work at once, as before.

`greedy` is today's behaviour. 2D's `WheelMode` still chooses what a wheel that reaches the plan does.

**`cooperative` by default in `embed.js`** (`data-gestures`), because a snippet is always on a page that scrolls. **`greedy` by default** in the View package, the Editor and the playground, where the plan is the page. A full-screen plan, such as a Kiosk, sets `data-gestures="greedy"`. For plans already embedded this is a change: they stop taking plain scrolling. It fixes a bug rather than breaking anything. The docs and the embedding guide say so.

**A click-to-activate shield was turned down.** It costs every visitor a click, and its veil hides that the plan is alive, which is the point of the hero. It also swallows the first tap on a Zone.

## The snippet tells its page when the plan is ready

**`embed.js` sends `areaform:ready` on the snippet's element** once the plan is drawn (`ready3d` for a plan in 3D, `ready` in 2D), as a bubbling `CustomEvent`. It is documented. The hero needs it to swap its still image. It is the first of the public events a host can listen to. Later ones, such as a click on a Zone, keep the `areaform:` prefix.

## Considered

- **`tour` later, after orbit,** as ADR-0022 had it. The flight itself is little more than orbit. The cost is the Document field, the Editor and the MCP, and we chose to build them now, together.
- **The views given only on the snippet** (`data-tour` with a JSON list). No Document change, but the plan would lose its tour when exported, and the owner could make one only by hand.
- **Saving `Camera3D` as it is** (a position and a target in Three.js space). The easiest to capture, but hard to read or write by hand or by an AI.
- **One tour for the whole Space,** each view naming its Level. It's ready for flights between Levels, but needs a rule for tours that mix them, which nothing needs yet.
- **Motion in render-3d alone.** Simpler, but the renderer would watch the page's visibility and scrolling.

## Consequences

- **Embedded plans scroll with the page.** Anyone relying on a plain wheel to zoom an embedded plan now holds ⌘/Ctrl, or sets `data-gestures="greedy"`.
- **The JSON Schema at `/schema/v1/` gains `viewpoints`,** additively, as ADR-0024 allows.
- **The manifest gains `motion`.** Manifests without it mean `none`.

## Later

- Flights between Levels, Viewpoints of a Zone, and the link builder opening a saved Viewpoint.
- A 2D tour, if phones turn out to need one.
- More public `areaform:*` events, such as a click on a Zone, for hosts.
- Search flying the camera to a Zone, as a tour of one Viewpoint framed with `framePose`.

## Update 2026-11-16: Play, Pause and auto-resume

Decided on 2026-11-16, after the release, and built in its own change.

- **A Play/Pause toggle among the plan controls,** in 3D while `motion` is `orbit` or `tour`. WCAG 2.2.2 (Pause, Stop, Hide) asks for a way to pause what moves on its own for more than 5 s, and a touch of the plan is not an obvious one. It shows **Pause** while the camera moves and **Play** once it has stopped, whether by the toggle or by a touch, and has texts in four languages. Pressing it is not a touch of the plan.
- **Pause sticks.** After the visitor's Pause, nothing starts the camera on its own: not auto-resume, not picking a floor. Only Play does, or the host's `setMotion` asking for a motion again: the page is the host's to change.
- **Play carries on.** The camera starts from wherever the visitor left it. A tour goes on to the Viewpoint after the last it reached (`stopTour` returns it), and an orbit turns from the angle it is at. Play works under reduced motion too, since the visitor asked, until their next touch; picking a floor meanwhile plays that floor's motion, as the visitor's own choice still stands.
- **Auto-resume, off by default.** `data-motion-resume="<seconds>"` on the snippet, `motionResume` on the View, at least 5 s. A camera a touch stopped moves again after that long without an interaction or the mouse moving over the plan, counted only while the plan is on screen and the tab is shown. This reverses "stops for good" for the snippets that ask for it, for a plan nobody reads for long, such as a Kiosk or a screen on a stand; on an ordinary page the visitor is reading, so it stays off.
- **It waits while something is read.** A Plugin holds it with `view.holdMotion(reason, on)`. Wayfinding holds it while its place card, its route or its "where are you" question is shown (the question too, since a visitor is answering it); with Wayfinding on, a tap on the plan opens a card, so it resumes after the card is closed. Resetting a Kiosk to its first view (closing the card, clearing the route) is a later idea, for real Kiosk owners to decide.
- **Later:** a Publish dialog setting for auto-resume, beside **Camera in 3D**.
