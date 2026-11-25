# Live car park

A three-level car park whose spots are coloured by a live feed of bay sensors. The panel counts the free spaces on each level and finds the free spot that gets a driver from the entry gate to the lift soonest. It draws the drive there, up the ramp when needed, and the walk from the spot to the lift, on the plan in 2D and 3D. When that spot is taken before the driver gets there, it offers the next one.

Plain TypeScript with [`@areaform/view`](../../../packages/view) and [`@areaform/wayfinding`](../../../packages/wayfinding). No framework, and no server: the feed is simulated in the page.

```sh
pnpm install
pnpm parking:dev
```

## The files

- [`public/plan.json`](public/plan.json) is the plan: three Levels, P0 to P2, with 40 spots each, driving lanes, walkways, a lift, stairs, a car ramp, and the entry gate on P0. Each spot is a Zone with its sensor in `data.sensorId`. You would usually draw a plan in the Editor; this one is made by [`plan/make-plan.ts`](plan/make-plan.ts), so it is easy to read and change (`pnpm plan` writes it again).
- [`src/feed.ts`](src/feed.ts) is the sensor feed: `{ sensorId, occupied, at }` events. It is simulated here; the comment at the top shows where a real WebSocket or MQTT feed goes. Nothing else changes when you swap it.
- [`src/parking.ts`](src/parking.ts) is the car park's logic, apart from the page: which Zones are spots, each spot's state (free, taken, reserved, or no signal from its sensor), free spaces per Level, the trip through each spot, and the best free spot. It is tested in [`parking.test.ts`](src/parking.test.ts).
- [`src/route.ts`](src/route.ts) draws the trip, as a small View Plugin.
- [`src/main.ts`](src/main.ts) puts it together: `createView` with a `styleResolver` for the colours, icons for the charging and accessible spots, and the panel.

## How it works

- **Colours come from your data, not from the plan.** The `styleResolver` reads each spot's state when the plan is drawn, and nothing is saved in the plan. When the feed reports, the page calls `view.setStyleResolver` again, at most once per frame.
- **Drives use the walking router on a driving copy of the plan.** `@areaform/wayfinding` finds routes for people on foot. `drivingPlan` gives it the plan as a driver sees it: every Zone but the lanes and the gate is to go round, and the only Connection is the car ramp, so a drive never takes the lift or crosses a walkway. Its navmesh keeps 1 m from the edges (`clearance`), so drives keep to the middle of the lanes. The plan itself is not changed.
- **The best spot is the quickest trip, not the shortest walk.** A trip is the drive from the gate (at 10 km/h, plus the climb up the ramp) and then the walk to the lift. A spot on the ground floor with a longer walk can beat one upstairs beside the lift.
- **Trips are found once.** The plan doesn't change while the page is open, so `tripsOf` finds all 120 trips as the page opens. Finding the best free spot then just compares the spots that are free.
- **Spots are Walk-around Zones** (`walkAround: true`): people walk round parked cars, not through them. Both the drive and the walk end on the floor beside the spot.
- **`parking` is not a built-in Space Kind.** [`parking.ts`](src/parking.ts) adds its Preset (spots that must not overlap, lanes and the gate where nothing may be put), which `diagnose` and the Editor read. See [Documents](../../../docs/guides/embedding.md#documents) in the embedding guide.
