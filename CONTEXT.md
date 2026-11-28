# Areaform

An embeddable engine for modelling any physical place (exhibition hall, office, store, warehouse, flat, cinema, open-air field) with an open data model. One model serves many products.

## Language

### The place

**Space**:
The whole physical place a client models — an exhibition centre, a flat, an office, a store, a warehouse. One Document describes exactly one Space.
_Avoid_: Venue, Object, Site (a Site holds Spaces), Building, Project

**Site**:
A set of Spaces placed together on a map — two exhibition centres across a city, a campus, the fields of one farm. Routes between Spaces belong to the Site. One building with several wings stays one Space with Level Groups.
_Avoid_: Map (the base map under it), Campus, Atlas, Portfolio

**Inner Space**:
A Space shown inside a Zone of another Space — a shop's own plan inside a shopping centre's unit, named by the Zone's `innerSpace` and optionally fitted into it. It stays a Space of its own with its own Document and Publish; only the outer Space's owner names it.
_Avoid_: Nested Space, Sub-space, Child Space, Tenant plan, Link

**Unit**:
A Zone a tenant occupies in a shopping centre (Zone Category `unit`), to let or let: the Zone an Inner Space is shown inside.
_Avoid_: Shop (the business, not its Zone), Lot, Store

**Through route**:
One route from Here in a Space, through a fitted Inner Space's entrance, to a place inside it: the shop's ground floor merged into its unit for routing, with the step "Enter Volt". Without a Fit there is none; the route ends at the unit.
_Avoid_: Nested route, Cross-space route, Site route (between the Spaces of a Site)

**Fit**:
Where an Inner Space's plan lies in its unit: turned by `rotation`, then moved by `x` and `y`. Both plans are in metres, so a Fit never scales. Without one, the Inner Space is shown on its own.
_Avoid_: Transform, Placement, Alignment

**Space Kind**:
What sort of place a Space is (exhibition, office, store, warehouse, cafe, mall, flat, or client-defined). It only selects a Preset; it never changes how the core behaves.
_Avoid_: Type, Category, Template

**Preset**:
A named bundle of defaults for a Space Kind — the grid step and level height applied when a Space is created, and the Zone Categories the editor suggests, each marked Exclusive or Restricted. It is looked up from the Space Kind, never stored. It names categories but does not colour them (the renderer's Theme does), and does not choose editor tools (the host does).
_Avoid_: Template, Profile, Theme

**Document**:
The serialised (JSON) form of one Space, including its schema version.
_Avoid_: File, Plan, Map

**Level**:
One horizontal storey of a Space, with its own elevation, ceiling height and Outline. All Levels share one coordinate system.
_Avoid_: Floor, Storey, Layer

**Ordinal**:
A Level's place in the vertical stack: 0 is the ground Level, higher numbers are above it, negative ones below ground. Levels in different Level Groups may share an ordinal. Moving a Level up or down changes its ordinal and re-stacks elevations.
_Avoid_: Index, Floor number

**Level Group**:
An optional display label that groups Levels in the level switcher (e.g. "Pavilion A") when a Space has several buildings. Not an entity of its own; several Levels may share an ordinal.
_Avoid_: Building, Wing, Section

**Outline**:
The footprint of a Level — the boundary of its floor area, possibly with holes (e.g. an atrium). Independent of Walls.
_Avoid_: Contour, Boundary, Perimeter

**Footprint**:
The optional outer contour of the whole Space as seen on a map: a building's walls from outside or a field's boundary. It need not match any Level's Outline; parts of the Footprint outside a Level's Outline are simply not in use.
_Avoid_: Outline (that is one Level's floor), Contour, Silhouette

**Content Language**:
A language the Space's own text (Zone labels; Level, Connection and Space names) is written in. A Space has one default Content Language (`languages.default`) and may offer others (`languages.others`); translations sit beside each text (`labels` beside `label`, `names` beside `name`), and the author picks which language they are filling in. Unrelated to the language of the Editor's interface ([ADR-0011](docs/adr/0011-content-languages-in-the-document.md)).
_Avoid_: Locale (that is the interface language), Translation (a translation is the text in one Content Language)

### Structure

**Wall**:
A straight wall edge between two Wall Nodes, with a thickness. Walls form a graph; they are a separate layer from the Outline.
_Avoid_: Segment, Partition (as a separate entity), Exterior wall (as a separate entity)

**Wall Node**:
A point shared by one or more Walls; moving it moves every Wall attached to it.
_Avoid_: Vertex, Joint, Corner

**Opening**:
A gap people can pass through — door, entrance, passage or emergency exit. Either **hosted** (placed at an offset along a Wall, moving with it) or **free** (placed by position and angle, typically on the Outline where no Wall is modelled).
_Avoid_: Door (as the general term), Gate, Portal

**Hinge**:
The jamb a door's leaf hangs from: the **start** or **end** of the Opening, looking along its Wall from the Wall's first Wall Node.
_Avoid_: Handing, Pivot

**Swing**:
The side of the Wall a door opens to, **left** or **right** looking from the Opening's start to its end.
_Avoid_: Opening direction (an Opening is the gap, not the motion)

**Connection**:
A means of moving between Levels — stairs, elevator, escalator or ramp — as one entity that stops on two or more Levels.
_Avoid_: Transition, Link, Portal, Vertical

**Stop**:
The part of a Connection on one particular Level: its footprint there and its entry point. A one-way Connection (an escalator) runs from its first Stop to its last.
_Avoid_: Landing, Station

### Areas

**Zone**:
A named, styled area on a Level that carries client data (a booth, a department, a bookable desk area).
_Avoid_: Area, Region, Room, Space

**Zone Category**:
A client-defined classification of a Zone (booth, aisle, room…), suggested by the Preset or defined in the Document with a name, colour and an icon from the collection ([ADR-0018](docs/adr/0018-zone-categories-in-the-document.md)), and used for default styling. The core attaches no meaning to it.
_Avoid_: Zone type, Kind, Tag

**Exclusive Category**:
A Zone Category whose Zones must not overlap one another (e.g. booths at an exhibition), declared by the Preset. An overlap is a Diagnostic, not an Invariant.
_Avoid_: Unique category, Non-overlapping zone

**Restricted Zone**:
A Zone that is walkable but where nothing may be placed — aisles, fire lanes, the space in front of emergency exits.
_Avoid_: Dead zone, No-go zone, Forbidden area

**Walk-around Zone**:
A Zone that visitors' routes go around, not through — a booth, a stall, a bay (`walkAround`). Defaulted from its category by the Preset and changeable per Zone. It can still be a destination: the route ends at its edge ([ADR-0017](docs/adr/0017-wayfinding-inside-one-space.md)).
_Avoid_: Blocking zone, Solid zone, Obstacle (an Obstacle is a physical thing, not an area)

**Obstacle**:
A physical element on a Level that blocks movement — a column, a non-connection shaft (ventilation, utilities), a void. Elevator and stair footprints are Stops, not Obstacles.
_Avoid_: Blocker, Dead zone

### Reserved (not in the MVP)

**Object**:
A physical thing placed on a Level — a shelf, desk, stand, café counter — as an instance of a reusable type. Distinct from a Zone: a Zone is an area, an Object is a thing that may sit inside one. Reserved for the next stage; nothing in the MVP may be called an Object.
_Avoid_: Item, Furniture, Asset, Element

### Authoring

**Element**:
Anything on a Level that can be selected and clicked: Wall, Wall Node, Opening, Zone, Obstacle, Stop, Underlay. The Outline is not an Element.
_Avoid_: Item, Object, Entity, Shape

**Grid Step**:
The spacing of the snapping grid, in metres. A drawing aid only — geometry is not confined to grid cells.
_Avoid_: Square size, Cell size, Tile

**Underlay**:
A reference image (e.g. a scanned drawing) placed beneath a Level and calibrated to real-world scale by two points and a known distance, used as a tracing aid. A Level may have several. Not part of the plan's geometry.
_Avoid_: Background, Backdrop, Blueprint, Overlay

**Command**:
A single, serialisable, undoable change to a Document. The only way a Document changes.
_Avoid_: Action, Operation, Mutation

**Invariant**:
A rule a Document must always satisfy; a Command that would break one is rejected.
_Avoid_: Constraint, Error

**Diagnostic**:
A non-blocking problem found in a Document (e.g. a Zone outside the Outline), reported to the user as a warning.
_Avoid_: Warning, Lint, Issue

**Tool**:
The Editor's current mode of pointer input — Select, Wall, Zone or Door. Exactly one is active.
_Avoid_: Mode (except for a tool's own variants, e.g. rectangle/polygon Zone drawing), Brush

**Overlay**:
Transient Editor graphics drawn above the plan — previews, snap markers, selection boxes. Never part of the Document.
_Avoid_: Preview layer, Ghost, Guides

**Snap**:
Moving a pointer position to the nearest meaningful point — a Wall Node, a vertex, an edge, the grid, or a 15° direction — unless Alt is held.
_Avoid_: Magnet, Align

### Import

**Source**:
The design a Draft is made from — a Figma frame or an image. Read by the agent; never stored in the Document except as an Underlay.
_Avoid_: Mock-up (as the general term), Input, Original

**Draft**:
A Document produced by an import and not yet reviewed by a person. It is an ordinary Document; only its Import Flags mark it as a Draft.
_Avoid_: Proposal, Generated plan, Sketch

**Import Flag**:
A note left by the import on one Element, or on a Level's Outline, that a person should check (a guessed category, an unclear door), kept in the Document's `meta` until the reviewer marks it done.
_Avoid_: Warning, Diagnostic (a Diagnostic is computed, an Import Flag is recorded), Todo

### Embedding

**Editor**:
The embeddable component for authoring a Space; it changes the Document through Commands.
_Avoid_: Builder (as a component name), Designer

**View**:
The embeddable read-only component for showing a Space to end users (pan, zoom, click, highlight). It never changes the Document.
_Avoid_: Viewer (reserved for the separate 2.5D product), Player, Preview

**Viewpoint**:
A camera saved on a Level: the floor point it looks at, the bearing it looks towards, its tilt and distance, and how long a tour flies to it and stays. A Level's Viewpoints, in order, are its tour.
_Avoid_: View (the component), Shot, Camera view, Bookmark

**Motion**:
How a View's camera moves on its own in 3D: still, turning slowly (orbit), or flying through the Viewpoints (tour). It stops on the first interaction inside the plan, when the host page moves the camera, and on **Pause**; **Play** moves it on from where it is. Unless auto-resume is on, nothing else starts it again but choosing another Level or 3D.
_Avoid_: Animation, Autoplay

**Camera from the page**:
The host page moving a View's camera itself (ADR-0030): a flight to a Viewpoint or a camera, a turn to a Zone or a point, or progress along a Level's Viewpoints as the page scrolls, by ids only. The visitor's touch always wins over it. A **flight** is one such move, ending on arrival or interrupted.
_Avoid_: Scroll animation, Camera script, Scripted tour (a tour is the Motion's)

**Auto-resume**:
Motion stopped by a touch of the plan starting again after some seconds of nobody touching it, while the plan is seen and no Plugin holds it (a route or a place card being read). Off unless the snippet asks for it; never after **Pause**. For a plan nobody reads for long, such as a Kiosk.
_Avoid_: Autoplay, Idle mode, Attract mode (an **Idle reset** is a separate thing: the whole View back to its start)

**Cooperative gestures**:
A View on a scrolling page lets a plain wheel and a one-finger swipe scroll the page, and moves the plan only with ⌘/Ctrl + wheel, a pinch or two fingers. The opposite is greedy, where the plan takes every gesture.
_Avoid_: Scroll lock, Click to activate

**Style Override**:
A host-supplied look for an Element at runtime (e.g. booth status colours), layered over the Document's own style. Never saved, never undoable.
_Avoid_: Theme, Runtime style, Highlight (highlight is one kind of override)

### Products

**App**:
A product built on top of a Space that keeps its own data outside the Document: booth booking, desk booking, online meetings. Many Apps can use one Space.
_Avoid_: Module, Extension, Product (as the term for this layer)

**Plugin**:
An extension of the View that adds behaviour without data of its own — a tooltip card, a link on click, a search box. Loaded only when a host asks for it.
_Avoid_: Extension, Add-on, Widget

**Wayfinding**:
The Plugin that shows the walking route from Here to a Zone or a point, through Openings and Connections, inside one Space or across a Site. On by default in `embed.js` ([ADR-0017](docs/adr/0017-wayfinding-inside-one-space.md)).
_Avoid_: Navigation (as the Plugin's name), Routing, Directions (that is the button's label)

**Here**:
The visitor's start point for Wayfinding, shown as "You are here": set by a tap, a Zone picked from a list, or `?here=` (a Zone id or a point on a Level, e.g. from a printed QR code).
_Avoid_: Location, Current position, Origin

**Kiosk**:
A Space shown on a touch screen in a public place (a shopping centre's "find a shop"), as a hosted Business feature: a Welcome Screen, then the map with big category buttons, back to the start when idle.
_Avoid_: Terminal, Totem, Signage (a signage player is one way to run a Kiosk)

**Kiosk Screen**:
One physical Kiosk set up in a Space's settings: its name, its Here and the way it faces, and its own link. Statistics are kept per Kiosk Screen.
_Avoid_: Device, Display, Station

**Welcome Screen**:
What a Kiosk shows while nobody touches it: the owner's slideshow or page; a touch opens the map.
_Avoid_: Splash screen, Screensaver, Attract loop

**Idle reset**:
A View put back as it opened after some seconds of nobody using the page (`idleAfter`, `idle`, `reset()`): its first Level and view, no route, Here where it started, the camera's motion from the start. The host may ask "Still here?" first. For the next visitor at a Kiosk ([ADR-0032](docs/adr/0032-a-kiosks-building-blocks-idle-reset-and-large-controls.md)).
_Avoid_: Timeout, Session end, Auto-resume (which only moves the camera again)

### Publishing

**Revision**:
A kept copy of a Space's whole Document, made by **Save version** or by **Publish**, named by the hash of its content and never changed. Visitors only ever get its stripped file, written when it is published; the full copy stays private so it can be opened in the Editor again. The web app calls a Revision a "version".
_Avoid_: Version in code and docs (that is the schema or library version), Snapshot, Release, Draft (a Draft is an unreviewed import)

**Save version**:
Keeping the saved Document as a Revision without showing it to visitors, with an optional name. A plan unchanged since a Revision adds nothing.
_Avoid_: Save (saving happens on its own, a second after each change), Checkpoint

**Invited editor**:
Someone invited by e-mail to edit one Space without Publish, such as a shop's person on the plan a centre made for its unit. They edit it and Save version; the Space's owner publishes. The Space is "Shared with you" for them.
_Avoid_: Guest, Collaborator, Member (a member belongs to the Organisation and may publish)

**Waiting to publish**:
A version an Invited editor saved, newer than what visitors see: the owner publishes it to approve it.
_Avoid_: Pending, Draft (a Draft is the MCP's), Review

**Publish**:
Making the current Document the one visitors see, kept as a Revision unless one already has its content. Showing an earlier Revision again is also a Publish.
_Avoid_: Deploy, Save (saving keeps the Document; it does not change what visitors see)
