// Visual centre of a polygon ("pole of inaccessibility"), after Mapbox's polylabel:
// the interior point farthest from any edge. Unlike the centroid, it is always inside.
import type { Ring, Shape, Vec2 } from '@areaform/core';

interface Cell {
    x: number;
    y: number;
    half: number;
    /** Signed distance from the centre to the shape boundary; positive inside. */
    d: number;
    /** Best distance any point in this cell could reach. */
    max: number;
}

/**
 * How close to the true centre the search stops, metres: 1% of the shape's shorter side, from
 * 1 cm to 10 cm. A fixed 1 cm made long, thin Zones (a corridor, a driveway) split cells along
 * their whole length, taking seconds each; a label a few centimetres off cannot be seen.
 */
export function centrePrecision(size: number): number {
    return Math.min(0.1, Math.max(0.01, size / 100));
}

export function visualCenter(shape: Shape, precision?: number): Vec2 {
    const rings = [shape.outer, ...(shape.holes ?? [])];
    const xs = shape.outer.map((p) => p[0]);
    const ys = shape.outer.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const height = Math.max(...ys) - minY;
    const size = Math.min(width, height);
    if (size === 0) return [minX, minY];
    const stop = precision ?? centrePrecision(size);

    const cell = (x: number, y: number, half: number): Cell => {
        const d = signedDistance([x, y], rings);
        return { x, y, half, d, max: d + half * Math.SQRT2 };
    };

    const queue = new CellQueue();
    for (let x = minX; x < minX + width; x += size) {
        for (let y = minY; y < minY + height; y += size) {
            queue.push(cell(x + size / 2, y + size / 2, size / 2));
        }
    }
    let best = cell(minX + width / 2, minY + height / 2, 0);
    const center = centroidCell(shape.outer, rings);
    if (center && center.d > best.d) best = center;

    for (let next = queue.pop(); next; next = queue.pop()) {
        if (next.d > best.d) best = next;
        if (next.max - best.d <= stop) continue;
        const h = next.half / 2;
        queue.push(
            cell(next.x - h, next.y - h, h),
            cell(next.x + h, next.y - h, h),
            cell(next.x - h, next.y + h, h),
            cell(next.x + h, next.y + h, h),
        );
    }
    return [best.x, best.y];
}

/** Cells by `max`, the most promising first: a binary heap, as in Mapbox's polylabel. */
class CellQueue {
    private readonly cells: Cell[] = [];

    push(...cells: Cell[]): void {
        for (const cell of cells) {
            const heap = this.cells;
            let i = heap.length;
            heap.push(cell);
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (heap[parent]!.max >= cell.max) break;
                heap[i] = heap[parent]!;
                i = parent;
            }
            heap[i] = cell;
        }
    }

    pop(): Cell | undefined {
        const heap = this.cells;
        const top = heap[0];
        const last = heap.pop();
        if (heap.length === 0 || !last) return top;
        let i = 0;
        for (;;) {
            const left = 2 * i + 1;
            if (left >= heap.length) break;
            const right = left + 1;
            const child = right < heap.length && heap[right]!.max > heap[left]!.max ? right : left;
            if (heap[child]!.max <= last.max) break;
            heap[i] = heap[child]!;
            i = child;
        }
        heap[i] = last;
        return top;
    }
}

function centroidCell(outer: Ring, rings: Ring[]): Cell | null {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
        const [x1, y1] = outer[j]!;
        const [x2, y2] = outer[i]!;
        const f = x1 * y2 - x2 * y1;
        cx += (x1 + x2) * f;
        cy += (y1 + y2) * f;
        area += f * 3;
    }
    if (area === 0) return null;
    const x = cx / area;
    const y = cy / area;
    return { x, y, half: 0, d: signedDistance([x, y], rings), max: 0 };
}

function signedDistance(p: Vec2, rings: Ring[]): number {
    let inside = false;
    let min = Infinity;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i]!;
            const b = ring[j]!;
            if (
                a[1] > p[1] !== b[1] > p[1] &&
                p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
            ) {
                inside = !inside;
            }
            min = Math.min(min, segmentDistance(p, a, b));
        }
    }
    return (inside ? 1 : -1) * min;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t =
        lengthSq === 0
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
