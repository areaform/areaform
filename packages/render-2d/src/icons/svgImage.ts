// SVG markup as a loaded image, for icons drawn as bitmaps in both views (ADR-0010). Drawing an
// SVG through an <img> never runs anything inside it, so a host's markup is safe to show.

const images = new Map<string, Promise<HTMLImageElement>>();

/**
 * Loads SVG markup as an image about `size` pixels across; one load per markup and size. Rejects
 * when the browser cannot read it.
 */
export function loadSvgImage(svg: string, size: number): Promise<HTMLImageElement> {
    const key = `${size}:${svg}`;
    let loading = images.get(key);
    if (!loading) {
        // Some browsers draw an SVG without its own width and height at no size at all.
        const sized = /^\s*<svg\b[^>]*\swidth=/.test(svg)
            ? svg
            : svg.replace(/<svg\b/, `<svg width="${size}" height="${size}"`);
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
        loading = image.decode().then(() => image);
        images.set(key, loading);
    }
    return loading;
}

/**
 * Where an image goes in a `size` square so it fits whole, centred, keeping its proportions:
 * x, y, width, height.
 */
export function containIn(
    image: { naturalWidth: number; naturalHeight: number },
    size: number,
    offset = 0,
): [number, number, number, number] {
    const w = image.naturalWidth || size;
    const h = image.naturalHeight || size;
    const scale = Math.min(size / w, size / h);
    return [offset + (size - w * scale) / 2, offset + (size - h * scale) / 2, w * scale, h * scale];
}
