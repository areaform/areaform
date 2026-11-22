// Reading a Figma frame through the REST API. Only the fields the extraction needs are typed.

/** A node from `GET /v1/files/:key/nodes?geometry=paths`. */
export interface FigmaNode {
    id: string;
    name: string;
    type: string;
    visible?: boolean;
    children?: FigmaNode[];
    /** Top two rows of the 2D transform relative to the parent. */
    relativeTransform?: [[number, number, number], [number, number, number]];
    size?: { x: number; y: number };
    /** On the canvas, axis-aligned. */
    absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
    fillGeometry?: { path: string; windingRule?: string }[];
    strokeWeight?: number;
    characters?: string;
}

export interface FigmaFrameRef {
    fileKey: string;
    /** In API form, `1:2`. */
    nodeId: string;
}

/** The file and node of a Figma link; the branch key stands in for the file key on a branch. */
export function parseFigmaUrl(url: string): FigmaFrameRef | undefined {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }
    if (!/(^|\.)figma\.com$/.test(parsed.hostname)) return undefined;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!['design', 'file'].includes(parts[0] ?? '')) return undefined;
    const fileKey = parts[2] === 'branch' ? parts[3] : parts[1];
    const nodeId = parsed.searchParams.get('node-id')?.replaceAll('-', ':');
    return fileKey && nodeId ? { fileKey, nodeId } : undefined;
}

/** The part of `fetch` the server uses, so tests can stand in for the network. */
export type Fetch = (
    url: string,
    init: { headers: Record<string, string> },
) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Fetches one node with its geometry; throws with the API's reason on failure. */
export async function fetchFigmaNode(
    { fileKey, nodeId }: FigmaFrameRef,
    token: string,
    fetcher: Fetch = fetch,
): Promise<FigmaNode> {
    const url =
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes` +
        `?ids=${encodeURIComponent(nodeId)}&geometry=paths`;
    const response = await fetcher(url, { headers: { 'X-Figma-Token': token } });
    const body = (await response.json()) as {
        err?: string;
        nodes?: Record<string, { document?: FigmaNode } | null>;
    };
    if (!response.ok) {
        throw new Error(`Figma answered ${response.status}${body.err ? `: ${body.err}` : ''}`);
    }
    const node = body.nodes?.[nodeId]?.document;
    if (!node) throw new Error(`Figma has no node ${nodeId} in file ${fileKey}`);
    return node;
}
