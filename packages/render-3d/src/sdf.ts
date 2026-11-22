// Signed distance fields for label bitmaps (ADR-0010), after Mapbox's TinySDF (BSD-2-Clause):
// Felzenszwalb and Huttenlocher's exact Euclidean distance transform, run once outside the shape
// and once inside. Pure, so it is tested without a canvas.

const INF = 1e20;

/** Where a distance field puts the edge of the shape, 0–1: the shader's alpha threshold. */
export const SDF_EDGE = 0.75;

/**
 * Turns coverage (0–255 per pixel, as a canvas alpha channel) into a distance field: 255 deep
 * inside, `SDF_EDGE` × 255 at the edge, falling to 0 at `radius` pixels × `SDF_EDGE` outside.
 */
export function distanceField(
    alpha: ArrayLike<number>,
    width: number,
    height: number,
    radius: number,
): Uint8Array {
    const size = width * height;
    const outer = new Float32Array(size).fill(INF);
    const inner = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const a = alpha[i]! / 255;
        if (a === 0) continue;
        if (a === 1) {
            outer[i] = 0;
            inner[i] = INF;
        } else {
            // A partly covered pixel: its edge lies part of the way across it.
            const d = 0.5 - a;
            outer[i] = d > 0 ? d * d : 0;
            inner[i] = d < 0 ? d * d : 0;
        }
    }
    const longest = Math.max(width, height);
    const f = new Float32Array(longest);
    const z = new Float32Array(longest + 1);
    const v = new Uint16Array(longest);
    transform(outer, width, height, f, v, z);
    transform(inner, width, height, f, v, z);

    const field = new Uint8Array(size);
    const cutoff = 1 - SDF_EDGE;
    for (let i = 0; i < size; i++) {
        const d = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!);
        field[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + cutoff))));
    }
    return field;
}

/** Squared distances to the nearest zero, in place: columns, then rows. */
function transform(
    grid: Float32Array,
    width: number,
    height: number,
    f: Float32Array,
    v: Uint16Array,
    z: Float32Array,
) {
    for (let x = 0; x < width; x++) transform1d(grid, x, width, height, f, v, z);
    for (let y = 0; y < height; y++) transform1d(grid, y * width, 1, width, f, v, z);
}

/** The 1D transform: the lower envelope of parabolas rooted at each sample. */
function transform1d(
    grid: Float32Array,
    offset: number,
    stride: number,
    length: number,
    f: Float32Array,
    v: Uint16Array,
    z: Float32Array,
) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    f[0] = grid[offset]!;
    for (let q = 1, k = 0; q < length; q++) {
        f[q] = grid[offset + q * stride]!;
        const q2 = q * q;
        let s: number;
        do {
            const r = v[k]!;
            s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
        } while (s <= z[k]! && --k > -1);
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q++) {
        while (z[k + 1]! < q) k++;
        const r = v[k]!;
        const qr = q - r;
        grid[offset + q * stride] = f[r]! + qr * qr;
    }
}
