// The View panel's Selected element, as JSON that fits the panel.

/**
 * JSON as people read it: two spaces in, but a list of numbers (a point, a shape's corners) on one
 * line, so a booth is a few lines instead of thirty.
 */
export function compactJSON(value: unknown): string {
    return (
        JSON.stringify(value, null, 2)
            // [12, 21]: a list of plain values on one line.
            .replace(
                /\[\s+([^[\]{}]*?)\s+\]/g,
                (_, items: string) => `[${items.replace(/\s+/g, ' ')}]`,
            )
            // [[12, 21], [15, 21]]: a list of such lists, too.
            .replace(
                /\[\s+((?:\[[^[\]{}]*\],?\s*)+?)\s*\]/g,
                (_, items: string) => `[${items.replace(/\s+/g, ' ').trim()}]`,
            )
    );
}
