// Thin Three.js adapter for floor labels (ADR-0010): bakes each label with the browser's canvas
// (names and icons as distance fields, host logos in their own colours) and uploads one texture
// and one mesh per atlas page. What to draw and where is decided in the tested pure layers
// (floorLabels.ts, atlas.ts, sdf.ts).
import { LABEL_FONT, LABEL_LINE_HEIGHT, loadSvgImage } from '@areaform/render-2d';
import {
    BufferAttribute,
    BufferGeometry,
    DataTexture,
    DoubleSide,
    Group,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    RedFormat,
    RGBAFormat,
    ShaderMaterial,
    UnsignedByteType,
} from 'three';
import { packAtlas, type AtlasPlace } from './atlas.ts';
import {
    LOGO_PAD,
    labelBitmap,
    labelQuads,
    SDF_RADIUS,
    type FloorLabel,
    type LabelBitmap,
} from './floorLabels.ts';
import type { ColorParser } from './meshes.ts';
import { distanceField, SDF_EDGE } from './sdf.ts';

/** A field takes a fraction of a millisecond; a frame bakes this long, so big plans fill in, not freeze. */
const BAKE_BUDGET_MS = 6;
/** Bitmaps kept between builds and views, so reopening 3D or undoing an edit bakes little. */
const BAKED_LIMIT = 20_000;

const vertexShader = /* glsl */ `
    uniform float flip;
    uniform float halfHeight;
    uniform float minPx;
    attribute vec2 offset;
    attribute vec4 labelColor;
    attribute float labelSize;
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vShown;

    void main() {
        // Hidden below the Theme's smallest label, measured on screen at the label's middle.
        vec4 middle = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float px = middle.w > 0.0 ? labelSize * projectionMatrix[1][1] * halfHeight / middle.w : 0.0;
        vShown = clamp((px - minPx) / (minPx * 0.25), 0.0, 1.0);
        vUv = uv;
        vColor = labelColor;
        // Turned half a circle about its middle when seen from the north, so it reads upright.
        vec2 o = flip > 0.5 ? -offset : offset;
        gl_Position = vShown > 0.0
            ? projectionMatrix * modelViewMatrix * vec4(position + vec3(o.x, 0.0, -o.y), 1.0)
            : vec4(2.0, 2.0, 2.0, 1.0);
    }
`;

/** Names and icons: a distance field, in the label's colour. */
const fieldShader = /* glsl */ `
    uniform sampler2D atlas;
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vShown;

    void main() {
        float d = texture2D(atlas, vUv).r;
        float edge = fwidth(d) * 0.7;
        float alpha = smoothstep(${SDF_EDGE} - edge, ${SDF_EDGE} + edge, d) * vShown * vColor.a;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor.rgb, alpha);
        #include <colorspace_fragment>
    }
`;

/** Logos: their own colours, as drawn by the browser (already in the screen's colour space). */
const colourShader = /* glsl */ `
    uniform sampler2D atlas;
    varying vec2 vUv;
    varying float vShown;

    void main() {
        vec4 colour = texture2D(atlas, vUv);
        float alpha = colour.a * vShown;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(colour.rgb, alpha);
    }
`;

/** The two kinds of atlas: one channel for distance fields, four for logos. */
const KINDS = {
    field: { pageSize: 2048, channels: 1, format: RedFormat, fragmentShader: fieldShader },
    colour: { pageSize: 1024, channels: 4, format: RGBAFormat, fragmentShader: colourShader },
} as const;
type Kind = keyof typeof KINDS;

export interface LabelLayer {
    /** A mesh per atlas page for these labels; give it back to `dispose` when replaced. */
    build(labels: FloorLabel[]): Group;
    dispose(group: Group): void;
    /** Bakes labels of the last build not yet drawn, for a few milliseconds; true when some were. */
    bake(): boolean;
    /**
     * Follows the camera: `lookingSouth` turns every label to read from the north, and
     * `heightPx` is the canvas height in CSS pixels, for the on-screen size check.
     */
    update(lookingSouth: boolean, heightPx: number): void;
}

/** Baked bitmaps by kind, size and content, oldest first; shared by every 3D view on the page. */
const baked = new Map<string, Uint8Array>();

interface Page {
    data: Uint8Array;
    texture: DataTexture;
}

export function createLabelLayer(options: {
    maxTextureSize: number;
    minLabelPx: number;
    color: ColorParser;
}): LabelLayer {
    const sizeOf = (kind: Kind) => Math.min(KINDS[kind].pageSize, options.maxTextureSize);
    // Shared by every page's material, so one write moves them all.
    const uniforms = {
        flip: { value: 0 },
        halfHeight: { value: 1 },
        minPx: { value: options.minLabelPx },
    };
    const draw = createDrawer();
    /** Labels of the last build still to bake, and the pages they go on. */
    let queue: Job[] = [];
    let pages: Record<Kind, Page[]> = { field: [], colour: [] };

    const copy = (bits: Uint8Array, job: Pick<Job, 'kind' | 'bitmap' | 'place'>) => {
        const { kind, bitmap, place } = job;
        const { channels } = KINDS[kind];
        const pageSize = sizeOf(kind);
        const target = pages[kind][place.page]!.data;
        const row = bitmap.width * channels;
        for (let y = 0; y < bitmap.height; y++) {
            target.set(
                bits.subarray(y * row, (y + 1) * row),
                ((place.y + y) * pageSize + place.x) * channels,
            );
        }
    };

    /** The pages and meshes of one kind of atlas, queueing the bitmaps not baked yet. */
    const buildKind = (kind: Kind, labels: FloorLabel[], group: Group) => {
        if (labels.length === 0) return;
        const pageSize = sizeOf(kind);
        const bitmaps = labels.map((l) => labelBitmap(l, pageSize));
        const atlas = packAtlas(bitmaps, pageSize);
        pages[kind] = Array.from({ length: atlas.pages }, () => newPage(kind, pageSize));
        labels.forEach((label, i) => {
            const job = { kind, bitmap: bitmaps[i]!, place: atlas.places[i]! };
            const key =
                label.svg !== undefined
                    ? `${kind}:${job.bitmap.fontPx}:${label.svg}`
                    : `${job.bitmap.fontPx}:${job.bitmap.width}:${label.lines.join('\n')}`;
            const bits = baked.get(key);
            if (bits) copy(bits, job);
            else queue.push({ ...job, key, lines: label.lines, svg: label.svg });
        });
        const quads = labelQuads(
            labels,
            bitmaps,
            atlas.places,
            atlas.pages,
            pageSize,
            options.color,
        );
        quads.forEach((q, page) => {
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(q.positions, 3));
            geometry.setAttribute('offset', new BufferAttribute(q.offsets, 2));
            geometry.setAttribute('uv', new BufferAttribute(q.uvs, 2));
            geometry.setAttribute('labelColor', new BufferAttribute(q.colors, 4));
            geometry.setAttribute('labelSize', new BufferAttribute(q.sizes, 1));
            geometry.setIndex(new BufferAttribute(q.indices, 1));
            const material = new ShaderMaterial({
                uniforms: { ...uniforms, atlas: { value: pages[kind][page]!.texture } },
                vertexShader,
                fragmentShader: KINDS[kind].fragmentShader,
                transparent: true,
                depthWrite: false,
                side: DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -4,
            });
            const mesh = new Mesh(geometry, material);
            // Positions are label middles; the quads reach past them, so bounds would cut.
            mesh.frustumCulled = false;
            mesh.renderOrder = 2;
            group.add(mesh);
        });
    };

    return {
        build(labels) {
            const group = new Group();
            queue = [];
            pages = { field: [], colour: [] };
            buildKind(
                'field',
                labels.filter((l) => !l.logo),
                group,
            );
            buildKind(
                'colour',
                labels.filter((l) => l.logo),
                group,
            );
            // Page by page, so a frame re-uploads one or two textures rather than all of them.
            queue.sort((a, b) => a.kind.localeCompare(b.kind) || a.place.page - b.place.page);
            return group;
        },
        dispose(group) {
            queue = [];
            pages = { field: [], colour: [] };
            for (const child of group.children) {
                const mesh = child as Mesh<BufferGeometry, ShaderMaterial>;
                mesh.geometry.dispose();
                (mesh.material.uniforms.atlas!.value as DataTexture).dispose();
                mesh.material.dispose();
            }
        },
        bake() {
            if (queue.length === 0) return false;
            const start = performance.now();
            const touched = new Set<Page>();
            const waiting: Job[] = [];
            let next = 0;
            while (next < queue.length && performance.now() - start < BAKE_BUDGET_MS) {
                const job = queue[next++]!;
                let bits = baked.get(job.key);
                if (!bits) {
                    let image: HTMLImageElement | undefined;
                    if (job.svg !== undefined) {
                        const loaded = svgImage(job.svg, imageSize(job));
                        // An SVG that cannot load stays blank; one still loading waits a frame.
                        if (loaded === 'failed') continue;
                        if (loaded === 'loading') {
                            waiting.push(job);
                            continue;
                        }
                        image = loaded;
                    }
                    bits = draw(job, image);
                    baked.set(job.key, bits);
                    if (baked.size > BAKED_LIMIT) baked.delete(baked.keys().next().value!);
                }
                copy(bits, job);
                touched.add(pages[job.kind][job.place.page]!);
            }
            queue = [...waiting, ...queue.slice(next)];
            for (const page of touched) page.texture.needsUpdate = true;
            return touched.size > 0;
        },
        update(lookingSouth, heightPx) {
            uniforms.flip.value = lookingSouth ? 1 : 0;
            uniforms.halfHeight.value = heightPx / 2;
        },
    };
}

function newPage(kind: Kind, size: number): Page {
    const { channels, format } = KINDS[kind];
    const data = new Uint8Array(size * size * channels);
    const texture = new DataTexture(data, size, size, format, UnsignedByteType);
    texture.unpackAlignment = 1;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return { data, texture };
}

/** A label still to bake, and where it goes. */
interface Job {
    kind: Kind;
    key: string;
    lines: string[];
    svg: string | undefined;
    bitmap: LabelBitmap;
    place: AtlasPlace;
}

/** The pixel size an SVG is loaded at: an icon's square, or a logo's longer side. */
function imageSize({ kind, bitmap }: Job): number {
    if (kind === 'field') return bitmap.fontPx;
    return Math.max(bitmap.width, bitmap.height) - 2 * LOGO_PAD;
}

/** SVGs as images by markup and size, as they load. */
const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();

/** The SVG as an image `size` pixels across, or how its loading stands; starts it on first ask. */
function svgImage(svg: string, size: number): HTMLImageElement | 'loading' | 'failed' {
    const key = `${size}:${svg}`;
    const known = images.get(key);
    if (known) return known;
    images.set(key, 'loading');
    loadSvgImage(svg, size).then(
        (image) => images.set(key, image),
        () => images.set(key, 'failed'),
    );
    return 'loading';
}

/**
 * Draws a label into its bitmap: lines of text or an icon as a distance field, or a logo in its
 * own colours (RGBA). As an SVG is drawn as an image rather than read, its scripts never run.
 */
function createDrawer() {
    let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    return (job: Job, image?: HTMLImageElement): Uint8Array => {
        const { width, height, fontPx } = job.bitmap;
        if (!context) {
            context =
                typeof OffscreenCanvas !== 'undefined'
                    ? new OffscreenCanvas(width, height).getContext('2d', {
                          willReadFrequently: true,
                      })
                    : document
                          .createElement('canvas')
                          .getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('No 2D canvas to draw labels with.');
        }
        const canvas = context.canvas;
        if (canvas.width < width) canvas.width = width;
        if (canvas.height < height) canvas.height = height;
        context.clearRect(0, 0, width, height);
        if (job.kind === 'colour') {
            if (image)
                context.drawImage(
                    image,
                    LOGO_PAD,
                    LOGO_PAD,
                    width - 2 * LOGO_PAD,
                    height - 2 * LOGO_PAD,
                );
            return new Uint8Array(context.getImageData(0, 0, width, height).data);
        }
        context.font = `${fontPx}px ${LABEL_FONT}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#000';
        if (image) {
            // An icon: fitted whole into its square, keeping its proportions.
            const scale = Math.min(fontPx / image.naturalWidth, fontPx / image.naturalHeight) || 1;
            const w = image.naturalWidth * scale || fontPx;
            const h = image.naturalHeight * scale || fontPx;
            context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
        }
        job.lines.forEach((line, i) => {
            const y = height / 2 + (i - (job.lines.length - 1) / 2) * LABEL_LINE_HEIGHT * fontPx;
            context!.fillText(line, width / 2, y);
        });
        const rgba = context.getImageData(0, 0, width, height).data;
        const alpha = new Uint8Array(width * height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
        return distanceField(alpha, width, height, SDF_RADIUS);
    };
}
