import { describe, expect, it } from 'vitest';
import { fetchFigmaNode, parseFigmaUrl, type Fetch } from './figma.ts';

describe('parseFigmaUrl', () => {
    it('reads the file key and node id of a frame link', () => {
        expect(parseFigmaUrl('https://www.figma.com/design/AbC123/Hall-A?node-id=1-2&t=x')).toEqual(
            {
                fileKey: 'AbC123',
                nodeId: '1:2',
            },
        );
        expect(parseFigmaUrl('https://figma.com/file/AbC123/Hall?node-id=12-345')).toEqual({
            fileKey: 'AbC123',
            nodeId: '12:345',
        });
    });

    it('uses the branch key on a branch', () => {
        expect(
            parseFigmaUrl('https://www.figma.com/design/Main1/branch/Br4nch/Hall?node-id=3-4'),
        ).toEqual({ fileKey: 'Br4nch', nodeId: '3:4' });
    });

    it('converts every dash of a layer inside an instance', () => {
        expect(parseFigmaUrl('https://www.figma.com/design/AbC123/Hall?node-id=I5-12;3-4')).toEqual(
            { fileKey: 'AbC123', nodeId: 'I5:12;3:4' },
        );
    });

    it('refuses links that name no frame or are not Figma', () => {
        expect(parseFigmaUrl('https://www.figma.com/design/AbC123/Hall')).toBeUndefined();
        expect(
            parseFigmaUrl('https://www.figma.com/board/AbC123/Hall?node-id=1-2'),
        ).toBeUndefined();
        expect(parseFigmaUrl('https://example.com/design/AbC123?node-id=1-2')).toBeUndefined();
        expect(parseFigmaUrl('not a url')).toBeUndefined();
    });
});

describe('fetchFigmaNode', () => {
    const answer =
        (status: number, body: unknown): Fetch =>
        async () => ({
            ok: status < 400,
            status,
            arrayBuffer: async () => new ArrayBuffer(0),
            json: async () => body,
        });

    it('asks for the node with its geometry, with the token', async () => {
        const calls: { url: string; headers: Record<string, string> }[] = [];
        const fetcher: Fetch = async (url, init) => {
            calls.push({ url, headers: init.headers });
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new ArrayBuffer(0),
                json: async () => ({
                    nodes: { '1:2': { document: { id: '1:2', name: 'F', type: 'FRAME' } } },
                }),
            };
        };
        const node = await fetchFigmaNode({ fileKey: 'K', nodeId: '1:2' }, 'secret', fetcher);
        expect(node.name).toBe('F');
        expect(calls).toEqual([
            {
                url: 'https://api.figma.com/v1/files/K/nodes?ids=1%3A2&geometry=paths',
                headers: { 'X-Figma-Token': 'secret' },
            },
        ]);
    });

    it("passes on Figma's reason for refusing", async () => {
        await expect(
            fetchFigmaNode(
                { fileKey: 'K', nodeId: '1:2' },
                't',
                answer(403, { status: 403, err: 'Invalid token' }),
            ),
        ).rejects.toThrow('Figma answered 403: Invalid token');
    });

    it('reports a node the file does not have', async () => {
        await expect(
            fetchFigmaNode(
                { fileKey: 'K', nodeId: '9:9' },
                't',
                answer(200, { nodes: { '9:9': null } }),
            ),
        ).rejects.toThrow('Figma has no node 9:9 in file K');
    });
});
