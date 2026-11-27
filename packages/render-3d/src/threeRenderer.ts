// Thin Three.js adapter (ADR-0007): uploads the meshes from buildLevelMeshes and wires up
// OrbitControls. What to draw is decided in the tested pure layers (meshes.ts, view.ts, sync.ts).
// It is loaded on demand by createRenderer3D, so Three.js stays out of the bundle until then.
import type { AreaformDocument, ElementRef, Id, Vec2, Viewpoint } from '@areaform/core';
import {
    contentLabelResolver,
    cooperativeTouch,
    defaultTheme,
    wheelGoesToPage,
    type Gestures,
} from '@areaform/render-2d';
import {
    BufferAttribute,
    BufferGeometry,
    Color,
    DirectionalLight,
    Group,
    HemisphereLight,
    Mesh,
    MeshLambertMaterial,
    PerspectiveCamera,
    Raycaster,
    Scene,
    TOUCH,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { CUT_SOFTNESS, cutawayOf, KERB_HEIGHT, wallCut } from './cutaway.ts';
import { buildLevelLabels, buildStopIcons } from './floorLabels.ts';
import { createLabelLayer } from './labelLayer.ts';
import { buildLevelMeshes, type LevelMeshes, type MeshData, type Rgb } from './meshes.ts';
import type { FloorLine, Renderer3D, Renderer3DEvents, Renderer3DOptions } from './renderer.ts';
import { createPicker, type WallCut } from './picking.ts';
import { createLevelSync } from './sync.ts';
import { buildZoneLayer, type OutlineData } from './zones.ts';
import { defaultTheme3D } from './theme3d.ts';
import {
    cameraOfPose,
    DEFAULT_FLIGHT,
    flightAt,
    nextIndex,
    poseOfCamera,
    tourAt,
    type FlightPath,
    type Pose,
} from './tour.ts';
import {
    FOV,
    frame,
    MAX_POLAR,
    nearPlane,
    orbitOf,
    radiusOf,
    VIEWS,
    type Camera3D,
    type Orbit,
    type Vec3,
} from './view.ts';

/** A press that moves less than this, CSS pixels, is a click rather than an orbit; a finger wobbles more. */
const CLICK_SLACK_PX = { mouse: 3, touch: 10 };
/** Sharper than this costs phones more than it shows; `maxPixelRatio` changes it. */
const MAX_PIXEL_RATIO = 2;
const DOOR_HEIGHT = 2.1;
/** How far past looking due east or west the camera turns before labels flip, as a sine. */
const FLIP_BAND = 0.1;
/** How long the orbit takes to reach its speed, seconds. */
const ORBIT_EASE_S = 1;
/** One finger does nothing in OrbitControls: under cooperative gestures it is the page's. */
const NO_TOUCH = -1 as TOUCH;

export async function createThreeRenderer(options: Renderer3DOptions): Promise<Renderer3D> {
    const { container } = options;
    const theme = options.theme ?? defaultTheme;
    const theme3d = { ...defaultTheme3D, ...options.theme3d };
    const doorHeight = options.doorHeight ?? DOOR_HEIGHT;
    const showLabels = options.labels ?? true;
    const cutaway = options.cutaway ?? true;
    let labelResolver = options.labelResolver;
    let contentLanguage = options.contentLanguage;
    /** The Content Languages the shown labels were built with, to rebuild them when they change. */
    let builtLanguages: AreaformDocument['languages'];
    let styleResolver = options.styleResolver;
    let highlighted: ElementRef[] = [];
    let gestures: Gestures = options.gestures ?? 'greedy';
    let inset = options.inset ?? 0;

    const renderer = new WebGLRenderer({ antialias: true });
    const pixelRatio = Math.min(
        globalThis.devicePixelRatio ?? 1,
        options.maxPixelRatio ?? MAX_PIXEL_RATIO,
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(new Color(theme3d.background));
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    // Lit so that floors and Zones show about their own colour from above, and Walls read as
    // solid by the difference between their faces. Three.js divides diffuse light by π, so the
    // intensities are multiples of it: 1·π shows a colour as it is.
    scene.add(new HemisphereLight('#ffffff', '#8a8a84', 0.7 * Math.PI));
    const sun = new DirectionalLight('#ffffff', 0.35 * Math.PI);
    sun.position.set(0.5, 1, 0.35);
    scene.add(sun);

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.zoomToCursor = true;
    controls.maxPolarAngle = MAX_POLAR;
    controls.screenSpacePanning = false; // pan across the floor, not up the screen
    const applyGestures = () => {
        // Cooperative: two fingers orbit and pinch, as one finger and a pinch do on a whole-page plan.
        controls.touches =
            gestures === 'cooperative'
                ? { ONE: NO_TOUCH, TWO: TOUCH.DOLLY_ROTATE }
                : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    };
    applyGestures();
    /** Turns a minute the orbit is asked for, and the speed it has eased up to. */
    let orbitTarget = 0;
    let orbitSpeed = 0;
    const orbitAt = (turnsPerMinute: number) => {
        orbitTarget = turnsPerMinute > 0 ? turnsPerMinute : 0;
        if (orbitTarget === 0) orbitSpeed = 0;
        controls.autoRotate = orbitTarget > 0;
    };
    /** The tour playing: where it started, how long it has played, and whether it is held. */
    let tour: {
        start: Pose;
        viewpoints: Viewpoint[];
        seconds: number;
        paused: boolean;
        /** A one-Viewpoint tour that has arrived, and now turns around it. */
        arrived: boolean;
        orbitAfter: number;
    } | null = null;
    /** The Viewpoint the tour stays at now, if any, so each stay is told once. */
    let tourStay: number | null = null;
    const flyTour = (seconds: number) => {
        if (!tour || tour.paused || tour.arrived || !levelId) return;
        tour.seconds += seconds;
        const state = tourAt(tour.start, tour.viewpoints, tour.seconds);
        const next = cameraOfPose(state.pose, levelId);
        camera.position.set(...next.position);
        controls.target.set(...next.target);
        const stay = state.arrived ? state.index : null;
        if (stay !== tourStay) {
            tourStay = stay;
            const reached = stay === null ? undefined : tour.viewpoints[stay];
            if (reached) emit('tourStep', reached);
        }
        if (state.done) {
            tour.arrived = true;
            orbitAt(tour.orbitAfter);
        }
    };
    /** The page's flight: from where, to where, how far along, and what to tell when it ends. */
    let flight: {
        from: Camera3D;
        to: Camera3D;
        seconds: number;
        elapsed: number;
        path: FlightPath;
        done: (arrived: boolean) => void;
    } | null = null;
    const endFlight = (arrived: boolean) => {
        const ended = flight;
        flight = null;
        ended?.done(arrived);
    };
    const flyFlight = (seconds: number) => {
        if (!flight || !levelId) return;
        flight.elapsed += seconds;
        const t = flight.seconds > 0 ? Math.min(1, flight.elapsed / flight.seconds) : 1;
        const next = flightAt(flight.from, flight.to, t, flight.path, levelId);
        camera.position.set(...next.position);
        controls.target.set(...next.target);
        if (t >= 1) endFlight(true);
    };

    const opaqueMaterial = new MeshLambertMaterial({ vertexColors: true });
    // What lies a hair above the floor is drawn in front of it by a depth bias as well as by its
    // lift, so far from the camera, where depth is coarse, the floor never shows through it.
    const zoneMaterial = new MeshLambertMaterial({
        vertexColors: true,
        ...onFloor(FLOOR_BIAS.zone),
    });
    const markMaterial = new MeshLambertMaterial({
        vertexColors: true,
        ...onFloor(FLOOR_BIAS.mark),
    });
    // Walls between the camera and the plan go down to a kerb when the camera is tilted and near
    // (cutaway.ts), worked out per vertex from its Wall's middle, so moving the camera never
    // rebuilds anything.
    const cut = {
        cutTarget: { value: new Vector2() },
        cutDirection: { value: new Vector2(0, -1) },
        cutAmount: { value: 0 },
    };
    const wallMaterial = new MeshLambertMaterial({ vertexColors: true });
    wallMaterial.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, cut);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', CUT_DECLARATIONS)
            .replace('#include <begin_vertex>', CUT_VERTEX);
    };
    const transparentMaterial = new MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        ...onFloor(FLOOR_BIAS.zone),
    });

    const parse = (css: string): Rgb => {
        const c = new Color(css);
        return [c.r, c.g, c.b];
    };
    const labelLayer = createLabelLayer({
        maxTextureSize: renderer.capabilities.maxTextureSize,
        minLabelPx: theme.minLabelPx,
        color: parse,
    });
    const sync = createLevelSync(
        (doc, level) => {
            const meshes = buildLevelMeshes(doc, level, {
                theme,
                theme3d,
                doorHeight,
                color: parse,
            });
            const group = new Group();
            group.add(new Mesh(geometryOf(meshes.opaque), opaqueMaterial));
            group.add(new Mesh(geometryOf(meshes.marks), markMaterial));
            const walls = geometryOf(meshes.walls);
            walls.setAttribute('anchor', new BufferAttribute(meshes.walls.anchors, 2));
            group.add(new Mesh(walls, wallMaterial));
            builtLanguages = doc.languages;
            const resolver = contentLabelResolver(labelResolver, doc.languages, contentLanguage);
            const labels = labelLayer.build([
                ...(showLabels
                    ? buildLevelLabels(level, {
                          theme,
                          theme3d,
                          ...(resolver && { labelResolver: resolver }),
                      })
                    : []),
                ...buildStopIcons(doc, level, { theme, theme3d }),
            ]);
            group.add(labels);
            const picker = createPicker(doc, level, { theme3d, doorHeight }, meshes.wallPieces);
            return { group, labels, bounds: meshes.bounds, picker };
        },
        ({ group, labels }) => {
            scene.remove(group);
            group.remove(labels);
            labelLayer.dispose(labels);
            for (const child of group.children) (child as Mesh).geometry.dispose();
        },
    );

    // Zones apart from the Level's other meshes: a new Style Override or highlight rebuilds only
    // them, never the Walls or the baked labels.
    let zones: Group | null = null;
    const clearZones = () => {
        if (!zones) return;
        scene.remove(zones);
        for (const child of zones.children) {
            const object = child as Mesh | LineSegments2;
            object.geometry.dispose();
            if (object instanceof LineSegments2) object.material.dispose();
        }
        zones = null;
    };
    const restyle = () => {
        clearZones();
        const level = doc?.levels.find((l) => l.id === levelId);
        if (!level) return;
        const layer = buildZoneLayer(level, {
            theme,
            color: parse,
            ...(styleResolver && { styleResolver }),
            highlight: highlighted,
        });
        zones = new Group();
        zones.add(new Mesh(geometryOf(layer.opaque), zoneMaterial));
        const glass = new Mesh(geometryOf(layer.transparent), transparentMaterial);
        glass.renderOrder = 1;
        zones.add(glass);
        for (const outline of layer.outlines) zones.add(outlineOf(outline, pixelRatio));
        scene.add(zones);
        dirty = true;
    };

    // Lines on the floor (a route), kept to draw again when another Level is shown.
    let lines: FloorLine[] = [];
    let lineGroup: Group | null = null;
    const drawLines = () => {
        if (lineGroup) {
            scene.remove(lineGroup);
            for (const child of lineGroup.children) {
                const line = child as LineSegments2;
                line.geometry.dispose();
                line.material.dispose();
            }
            lineGroup = null;
        }
        const shown = lines.filter((l) => l.levelId === levelId && l.points.length > 1);
        if (shown.length > 0) {
            lineGroup = new Group();
            shown.forEach((line, i) => {
                if (line.casing)
                    lineGroup!.add(
                        floorLineOf(line, line.casing, pixelRatio, LINE_ORDER + i * 0.01),
                    );
                lineGroup!.add(floorLineOf(line, line, pixelRatio, LINE_ORDER + i * 0.01 + 0.005));
            });
            scene.add(lineGroup);
        }
        dirty = true;
    };

    let doc: AreaformDocument | null = null;
    let levelId: Id | null = null;
    let bounds: LevelMeshes['bounds'] | null = null;
    let picker: ReturnType<typeof createPicker> | null = null;
    let framed = false;
    /** The visitor has moved the camera: a new inset keeps their view rather than framing again. */
    let moved = false;
    let dirty = true;
    const listeners = new Map<keyof Renderer3DEvents, Set<(e: never) => void>>();
    const emit = <E extends keyof Renderer3DEvents>(event: E, payload: Renderer3DEvents[E]) => {
        for (const handler of listeners.get(event) ?? [])
            (handler as (e: Renderer3DEvents[E]) => void)(payload);
    };

    const show = () => {
        if (!doc || !levelId) return;
        const { built, rebuilt } = sync.show(doc, levelId);
        if (!rebuilt) return;
        bounds = built?.bounds ?? null;
        picker = built?.picker ?? null;
        if (built) scene.add(built.group);
        restyle();
        drawLines();
        dirty = true;
    };

    /** Frames the Level from `orbit`, and fits zoom limits and clipping to its size. */
    const frameFrom = (orbit: Orbit) => {
        if (!bounds) return;
        const radius = radiusOf(bounds);
        const { position, target } = frame(bounds, orbit, FOV, camera.aspect);
        camera.position.set(...position);
        controls.target.set(...target);
        limitTo(radius);
        controls.update();
        framed = true;
        dirty = true;
    };
    /** Half the diagonal of the Level shown, for the camera's limits and its depth range. */
    let levelRadius = 1;
    const limitTo = (radius: number) => {
        levelRadius = radius;
        controls.minDistance = Math.max(0.5, radius * 0.02);
        controls.maxDistance = radius * 6;
        followDepth();
    };
    /**
     * The depth range follows the camera: its near plane a hundredth of the way to what it looks
     * at (`nearPlane`), so depth stays fine far away; its far plane past the whole Level.
     */
    const followDepth = () => {
        const distance = camera.position.distanceTo(controls.target);
        const near = nearPlane(distance, levelRadius);
        const far = Math.max(levelRadius * 20, distance + levelRadius * 2);
        if (Math.abs(near - camera.near) < near * 0.01 && far === camera.far) return;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
    };
    const currentOrbit = (): Orbit => orbitOf(camera.position.toArray(), controls.target.toArray());
    const getCamera = (): Camera3D => ({
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        levelId: levelId ?? '',
    });

    let labelHeightPx = 1;
    // Labels read upright looking north; looking south, they turn round. The band around looking east or
    // west keeps them from flipping back and forth while the camera settles there.
    let lookingSouth = false;
    const followLabels = () => {
        const dx = controls.target.x - camera.position.x;
        const dz = controls.target.z - camera.position.z;
        const across = Math.hypot(dx, dz) * FLIP_BAND;
        if (dz > across) lookingSouth = true;
        else if (dz < -across) lookingSouth = false;
        labelLayer.update(lookingSouth, labelHeightPx);
    };
    /**
     * How big a name of the Theme's label size shows at the orbit target, over the smallest label
     * drawn: measured as the label shader does, so Walls are down by the time names fade in.
     */
    const textScaleNow = (): number => {
        const distance = camera.position.distanceTo(controls.target);
        const px =
            (theme.labelSize * camera.projectionMatrix.elements[5]! * (labelHeightPx / 2)) /
            Math.max(distance, 1e-9);
        return px / theme.minLabelPx;
    };
    const followCutaway = () => {
        if (!cutaway) return;
        const { direction, amount } = cutawayOf(
            camera.position.toArray(),
            controls.target.toArray(),
            textScaleNow(),
        );
        cut.cutTarget.value.set(controls.target.x, controls.target.z);
        cut.cutDirection.value.set(...direction);
        cut.cutAmount.value = amount;
    };

    const resize = () => {
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        renderer.setSize(width, height, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        // A covered strip on the left: the camera's own view is the rest, and the canvas shows
        // the strip as well, to the left of it, so the plan still runs under the cover.
        const left = Math.min(Math.max(0, inset), width / 2);
        camera.aspect = (width - left) / height;
        if (left > 0) camera.setViewOffset(width - left, height, -left, 0, width, height);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
        labelHeightPx = height;
        dirty = true;
        // A new aspect moves every point on screen, so things drawn over the canvas move too.
        emit('cameraChange', getCamera());
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const onChange = () => {
        dirty = true;
        emit('cameraChange', getCamera());
    };
    controls.addEventListener('change', onChange);
    // The visitor's drag or zoom: the camera is theirs, and a page's flight ends where it is.
    const onStart = () => {
        moved = true;
        endFlight(false);
    };
    controls.addEventListener('start', onStart);

    // --- Picking: clicks and hover, with the same events as the 2D renderer ---------------------

    const canvas = renderer.domElement;
    const raycaster = new Raycaster();
    const local = (e: PointerEvent): Vec2 => {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
    };
    /**
     * How Walls are lowered as they are drawn now, for picking. `byTilt` lowers them by the tilt
     * alone, as from near: a pin is hidden only by a Wall that would still stand close up, so pins
     * behind the Walls a far view leaves standing keep showing.
     */
    const wallCutNow = (byTilt = false): WallCut | undefined => {
        if (!cutaway) return undefined;
        const target = controls.target.toArray();
        const view = cutawayOf(
            camera.position.toArray(),
            target,
            byTilt ? undefined : textScaleNow(),
        );
        return ([x, y]) => wallCut([x, -y], target, view);
    };
    /** What is under a canvas point, with Walls lowered as they are drawn. */
    const hit = (screen: Vec2) => {
        if (!picker) return null;
        const rect = canvas.getBoundingClientRect();
        raycaster.setFromCamera(
            new Vector2(
                (screen[0] / (rect.width || 1)) * 2 - 1,
                1 - (screen[1] / (rect.height || 1)) * 2,
            ),
            camera,
        );
        const { origin, direction } = raycaster.ray;
        const found = picker(
            { origin: origin.toArray(), direction: direction.toArray() },
            wallCutNow(),
        );
        // Off into the sky there is no plan point: the one the camera looks at stands in.
        return {
            ref: found.ref,
            point: found.point ?? ([controls.target.x, -controls.target.z] as Vec2),
        };
    };

    let press: { id: number; start: Vec2; slack: number; moved: boolean } | null = null;
    /** Pointers down now: with two, a pinch or pan is under way and nothing is clicked. */
    const down = new Set<number>();
    let hovered: string | null = null;
    /** The last pointer position to hover, picked once per frame however fast the pointer moves. */
    let hoverAt: Vec2 | null = null;
    const hover = () => {
        if (!hoverAt) return;
        const screen = hoverAt;
        hoverAt = null;
        const found = hit(screen);
        if (!found) return;
        const key = found.ref ? `${found.ref.kind}:${found.ref.id}` : null;
        if (key === hovered) return;
        hovered = key;
        emit('elementHover', { ref: found.ref, point: found.point, screen });
    };
    const onPointerDown = (e: PointerEvent) => {
        down.add(e.pointerId);
        press =
            e.button === 0 && down.size === 1
                ? {
                      id: e.pointerId,
                      start: local(e),
                      slack:
                          e.pointerType === 'mouse' ? CLICK_SLACK_PX.mouse : CLICK_SLACK_PX.touch,
                      moved: false,
                  }
                : null;
    };
    const onPointerMove = (e: PointerEvent) => {
        const screen = local(e);
        if (down.size > 0) {
            if (press?.id === e.pointerId) {
                const [x, y] = press.start;
                if (Math.hypot(screen[0] - x, screen[1] - y) > press.slack) press.moved = true;
            }
            return;
        }
        // Orbiting with another button: nothing is hovered until it is let go.
        if (e.buttons === 0) hoverAt = screen;
    };
    const onPointerUp = (e: PointerEvent) => {
        down.delete(e.pointerId);
        const clicked = press?.id === e.pointerId && !press.moved && e.button === 0;
        press = null;
        if (!clicked) return;
        const screen = local(e);
        const found = hit(screen);
        if (!found) return;
        if (found.ref)
            emit('elementClick', { ref: found.ref, point: found.point, screen, originalEvent: e });
        else emit('backgroundClick', { point: found.point, screen, originalEvent: e });
    };
    const onPointerCancel = (e: PointerEvent) => {
        down.delete(e.pointerId);
        press = null;
    };
    const onPointerLeave = () => {
        hoverAt = null;
        if (hovered === null || press) return;
        hovered = null;
        emit('elementHover', {
            ref: null,
            point: [controls.target.x, -controls.target.z],
            screen: [-1, -1],
        });
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointercancel', onPointerCancel);
    // The browser can drop the WebGL context (memory pressure, a GPU reset, a phone backgrounding
    // the page). Three.js rebuilds what it holds when the context comes back, but not the clear
    // colour; set it again and draw, since frames are only drawn when something changed.
    const onContextRestored = () => {
        renderer.setClearColor(new Color(theme3d.background));
        dirty = true;
    };
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // Cooperative gestures: a plain wheel is the page's. Caught on the way down to the canvas, so
    // OrbitControls never sees it, and not prevented, so the page scrolls.
    const onWheel = (e: WheelEvent) => {
        if (!wheelGoesToPage(gestures, e)) return;
        e.stopPropagation();
        emit('gestureHint', 'wheel');
    };
    container.addEventListener('wheel', onWheel, { capture: true });
    const touch = cooperativeTouch(
        canvas,
        () => gestures,
        (hint) => emit('gestureHint', hint),
    );

    // Draws only when something moved: damping keeps `update` reporting change until it settles.
    let lastFrame: number | null = null;
    renderer.setAnimationLoop((time) => {
        const seconds = lastFrame === null ? 0 : Math.min(0.1, (time - lastFrame) / 1000);
        lastFrame = time;
        hover();
        if (orbitTarget > 0) {
            orbitSpeed = Math.min(orbitTarget, orbitSpeed + (orbitTarget * seconds) / ORBIT_EASE_S);
            // OrbitControls' speed is in turns a minute: 1 is a turn in 60 s.
            controls.autoRotateSpeed = orbitSpeed;
        }
        flyTour(seconds);
        flyFlight(seconds);
        controls.update(seconds);
        if (labelLayer.bake()) dirty = true;
        if (!dirty) return;
        dirty = false;
        followLabels();
        followCutaway();
        followDepth();
        renderer.render(scene, camera);
    });

    return {
        update(next) {
            doc = next;
            // A Level keeps its object when only the Space's languages change, but its names do not.
            if (contentLanguage !== undefined && next.languages !== builtLanguages) sync.clear();
            const shown = levelId;
            if (!levelId || !next.levels.some((l) => l.id === levelId))
                levelId = next.levels[0]?.id ?? null;
            show();
            if (!framed) frameFrom(VIEWS.perspective);
            // The shown Level was deleted or undone away: frame the one shown instead.
            else if (levelId !== shown) frameFrom(currentOrbit());
        },
        setLevel(id) {
            if (id === levelId) return;
            endFlight(false);
            levelId = id;
            show();
            frameFrom(framed ? currentOrbit() : VIEWS.perspective);
        },
        setView(view) {
            endFlight(false);
            frameFrom(VIEWS[view]);
        },
        fitLevel() {
            endFlight(false);
            frameFrom(currentOrbit());
        },
        setLabelResolver(resolver) {
            labelResolver = resolver;
            // Names and logos are baked into the Level's build, so build it again.
            sync.clear();
            show();
        },
        setContentLanguage(language) {
            if (language === contentLanguage) return;
            contentLanguage = language;
            sync.clear();
            show();
        },
        setStyleResolver(resolver) {
            styleResolver = resolver;
            restyle();
        },
        highlight(refs) {
            highlighted = refs;
            restyle();
        },
        setLines(next) {
            lines = next;
            drawLines();
        },
        toScreen([x, y], height = 0) {
            const projected = new Vector3(x, height, -y).project(camera);
            if (projected.z > 1) return null;
            const rect = canvas.getBoundingClientRect();
            return [((projected.x + 1) / 2) * rect.width, ((1 - projected.y) / 2) * rect.height];
        },
        isHidden([x, y], height = 0) {
            if (!picker) return false;
            const origin = camera.position.toArray();
            const direction: Vec3 = [x - origin[0], height - origin[1], -y - origin[2]];
            const length = Math.hypot(...direction);
            // What stands within a hand of the point, e.g. the booth a pin is at the edge of,
            // does not hide it.
            const { distance } = picker({ origin, direction }, wallCutNow(true));
            return distance * length < length - HIDDEN_SLACK;
        },
        getCamera,
        setCamera(view) {
            endFlight(false);
            if (view.levelId !== levelId) {
                frameFrom(orbitOf(view.position, view.target));
                return;
            }
            camera.position.set(...view.position);
            controls.target.set(...view.target);
            if (bounds) limitTo(radiusOf(bounds));
            controls.update();
            framed = true;
            dirty = true;
        },
        setGestures(next) {
            gestures = next;
            applyGestures();
            touch.apply();
        },
        setInset(left) {
            if (left === inset) return;
            const orbit = currentOrbit();
            inset = left;
            resize();
            // Framed again for the new view, unless the visitor has moved the camera themselves.
            if (framed && !moved) frameFrom(orbit);
        },
        setOrbit(turnsPerMinute) {
            orbitAt(turnsPerMinute ?? 0);
        },
        playTour(viewpoints, { orbitAfter = 0 } = {}) {
            endFlight(false);
            orbitAt(0);
            tourStay = null;
            tour =
                viewpoints.length > 0
                    ? {
                          start: poseOfCamera(getCamera()),
                          viewpoints,
                          seconds: 0,
                          paused: false,
                          arrived: false,
                          orbitAfter,
                      }
                    : null;
        },
        pauseTour(paused) {
            if (!tour) return;
            tour.paused = paused;
            if (tour.arrived) orbitAt(paused ? 0 : tour.orbitAfter);
        },
        stopTour() {
            if (!tour) return 0;
            if (tour.arrived) orbitAt(0);
            const state = tourAt(tour.start, tour.viewpoints, tour.seconds);
            const next = nextIndex(state, tour.viewpoints.length);
            tour = null;
            return next;
        },
        flyTo(to, { seconds = DEFAULT_FLIGHT, path = 'arc' } = {}) {
            endFlight(false);
            if (!levelId) return Promise.resolve(false);
            orbitAt(0);
            tour = null;
            return new Promise<boolean>((resolve) => {
                flight = {
                    from: getCamera(),
                    to: { position: to.position, target: to.target, levelId: levelId! },
                    seconds: Math.max(0, seconds),
                    elapsed: 0,
                    path,
                    done: resolve,
                };
                // No time to take: there now, without waiting for a frame.
                if (flight.seconds === 0) flyFlight(0);
                dirty = true;
            });
        },
        stopFlight() {
            endFlight(false);
        },
        on(event, handler) {
            const set = listeners.get(event) ?? new Set();
            set.add(handler as (e: never) => void);
            listeners.set(event, set);
            return () => set.delete(handler as (e: never) => void);
        },
        destroy() {
            endFlight(false);
            renderer.setAnimationLoop(null);
            container.removeEventListener('wheel', onWheel, { capture: true });
            touch.dispose();
            resizeObserver.disconnect();
            controls.removeEventListener('change', onChange);
            controls.removeEventListener('start', onStart);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointerleave', onPointerLeave);
            canvas.removeEventListener('pointercancel', onPointerCancel);
            canvas.removeEventListener('webglcontextrestored', onContextRestored);
            controls.dispose();
            sync.clear();
            clearZones();
            lines = [];
            drawLines();
            opaqueMaterial.dispose();
            zoneMaterial.dispose();
            markMaterial.dispose();
            wallMaterial.dispose();
            transparentMaterial.dispose();
            renderer.dispose();
            // Browsers allow only a few live WebGL contexts; switching views must not leak them.
            renderer.forceContextLoss();
            renderer.domElement.remove();
        },
    };
}

const CUT_DECLARATIONS = /* glsl */ `
    #include <common>
    attribute vec2 anchor;
    uniform vec2 cutTarget;
    uniform vec2 cutDirection;
    uniform float cutAmount;
`;

/** How near in front of a point something may stand without hiding it, metres. */
const HIDDEN_SLACK = 0.3;

// As wallCut in cutaway.ts: the whole Wall goes down by how much nearer its middle is than the target.
const CUT_VERTEX = /* glsl */ `
    #include <begin_vertex>
    {
        float depth = dot(anchor - cutTarget, cutDirection);
        float cut = cutAmount * (1.0 - smoothstep(-${CUT_SOFTNESS.toFixed(1)}, ${CUT_SOFTNESS.toFixed(1)}, depth));
        transformed.y = mix(transformed.y, min(transformed.y, ${KERB_HEIGHT.toFixed(2)}), cut);
    }
`;

function geometryOf(data: MeshData): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(data.colors, 4));
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * Outline segments `width` CSS pixels wide at any distance, as in 2D. They draw after see-through
 * Zones and before names, without writing depth, so a highlight later in the order covers a
 * neighbour's outline on a shared edge instead of fighting it.
 */
function outlineOf(data: OutlineData, pixelRatio: number): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(data.positions);
    geometry.setColors(data.colors);
    const material = new LineMaterial({
        linewidth: data.width * pixelRatio,
        vertexColors: true,
        transparent: true,
        opacity: data.opacity,
        depthWrite: false,
        ...onFloor(FLOOR_BIAS.outline),
    });
    const lines = new LineSegments2(geometry, material);
    lines.renderOrder = data.highlight ? 1.6 : 1.5;
    return lines;
}

/**
 * The depth bias, in the depth buffer's own steps, of each layer that lies on the floor: each
 * a step in front of the one under it, so none of them fights the floor or each other.
 */
const FLOOR_BIAS = { zone: 2, mark: 3, outline: 4, line: 5 };

/** A material's settings for a layer drawn `steps` depth steps in front of what it lies on. */
function onFloor(steps: number) {
    return { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -steps };
}

/** How high over the floor lines on it are drawn, metres: just clear of the Zones on it. */
const LINE_HEIGHT = 0.05;
/** Lines on the floor draw after Zones and their outlines, before names. */
const LINE_ORDER = 1.7;

/**
 * One of a floor line's strokes (`stroke` is the line itself or its casing): `width` CSS pixels at
 * any distance, dashed along the floor if asked. It is tested against depth, so Walls and
 * Obstacles in front hide it, but does not write it, so its casing never hides the line.
 */
function floorLineOf(
    line: FloorLine,
    stroke: { color: string; width: number; opacity?: number },
    pixelRatio: number,
    order: number,
): LineSegments2 {
    const positions: number[] = [];
    for (let i = 1; i < line.points.length; i++) {
        const [a, b] = [line.points[i - 1]!, line.points[i]!];
        positions.push(a[0], LINE_HEIGHT, -a[1], b[0], LINE_HEIGHT, -b[1]);
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const dashed = line.dash !== undefined && stroke === line;
    const material = new LineMaterial({
        color: new Color(stroke.color),
        linewidth: stroke.width * pixelRatio,
        transparent: true,
        opacity: stroke.opacity ?? 1,
        depthWrite: false,
        ...onFloor(FLOOR_BIAS.line),
        dashed,
        ...(dashed && { dashSize: line.dash![0], gapSize: line.dash![1] }),
    });
    const segments = new LineSegments2(geometry, material);
    // Dashes run on along the whole line, not from the start of each segment.
    if (dashed) segments.computeLineDistances();
    segments.renderOrder = order;
    return segments;
}
