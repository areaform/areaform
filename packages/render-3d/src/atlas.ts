// Packs label bitmaps into square texture pages (ADR-0010): rows of bitmaps, tallest first, so
// a page wastes little. Pure, so it is tested without WebGL.

export interface AtlasPlace {
    page: number;
    /** Top-left corner on the page, pixels. */
    x: number;
    y: number;
}

/** Room left around each bitmap, so sampling one never bleeds into its neighbour. */
const GAP = 1;

/**
 * Places each `{ width, height }` (pixels, at most `pageSize` each) on a page `pageSize` square,
 * filling pages in order; returns a place per size, in the order given, and how many pages.
 */
export function packAtlas(
    sizes: { width: number; height: number }[],
    pageSize: number,
): { places: AtlasPlace[]; pages: number } {
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.height - sizes[a]!.height);
    const places: AtlasPlace[] = new Array(sizes.length);
    let page = 0;
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const i of order) {
        const { width, height } = sizes[i]!;
        if (x + width > pageSize) {
            // Next row.
            x = 0;
            y += rowHeight + GAP;
            rowHeight = 0;
        }
        if (y + height > pageSize) {
            page++;
            x = 0;
            y = 0;
            rowHeight = 0;
        }
        places[i] = { page, x, y };
        x += width + GAP;
        rowHeight = Math.max(rowHeight, height);
    }
    return { places, pages: sizes.length === 0 ? 0 : page + 1 };
}
