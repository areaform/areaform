import type { Vec2 } from '@areaform/core';

/**
 * How a Source maps onto the plan: Source units grow right and down from its top-left corner,
 * the plan is in metres with Y up, and the Source's bottom-left corner lands on the origin.
 */
export interface Calibration {
    /** Metres per Source unit. */
    scale: number;
    /** Width and height of the Source in its own units. */
    size: Vec2;
}

/** The scale that puts two Source points `distance` metres apart; undefined if they coincide. */
export function scaleFrom(p1: Vec2, p2: Vec2, distance: number): number | undefined {
    const units = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (!(units > 0) || !(distance > 0) || !Number.isFinite(distance)) return undefined;
    return distance / units;
}

export function sourceToPlan({ scale, size }: Calibration, [x, y]: Vec2): Vec2 {
    return [x * scale, (size[1] - y) * scale];
}

/** Where the Source's top-left corner lies on the plan; an Underlay's `position`. */
export function sourceTopLeft(calibration: Calibration): Vec2 {
    return sourceToPlan(calibration, [0, 0]);
}

export type ImageType = 'png' | 'jpeg';

/** The type and size in pixels of a PNG or JPEG image, or undefined for anything else. */
export function imageInfo(bytes: Uint8Array): { type: ImageType; size: Vec2 } | undefined {
    const size = imageSize(bytes);
    if (!size) return undefined;
    return { type: bytes[0] === 0x89 ? 'png' : 'jpeg', size };
}

function imageSize(bytes: Uint8Array): Vec2 | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const isPng =
        bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452;
    if (isPng) return [view.getUint32(16), view.getUint32(20)];
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return undefined;
    // JPEG: walk the segments to the first start-of-frame marker, which holds the size.
    let offset = 2;
    while (offset + 9 <= bytes.length) {
        if (bytes[offset] !== 0xff) return undefined;
        const marker = bytes[offset + 1]!;
        const isStartOfFrame =
            marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isStartOfFrame) return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
        offset += 2 + view.getUint16(offset + 2);
    }
    return undefined;
}
