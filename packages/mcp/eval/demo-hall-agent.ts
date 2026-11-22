// The agent's side of the demo-hall round trip (docs/guides/mcp.md): the Commands an agent sent after
// reading the Figma frame drawn by `draw-demo-hall.figma.js` with the Figma MCP's get_metadata,
// replayed against the MCP server over stdio.
//   node packages/mcp/eval/demo-hall-agent.ts <frame screenshot.png> <out dir> [figma frame url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [screenshot, out, FIGMA] = process.argv.slice(2);
if (!screenshot || !out) {
    console.error(
        'Usage: node packages/mcp/eval/demo-hall-agent.ts <screenshot.png> <out dir> [figma url]',
    );
    process.exit(1);
}
mkdirSync(out, { recursive: true });
const server = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const client = new Client({ name: 'round-trip', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [server] }));
const log: string[] = [];
const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
        content: { type: string; text?: string; data?: string }[];
        isError?: boolean;
    };
    const text = r.content.find((c) => c.type === 'text')?.text ?? '';
    log.push(`${name} ${r.isError ? 'ERROR ' : ''}${text.slice(0, 300)}`);
    if (r.isError) throw new Error(`${name}: ${text}`);
    return { body: text ? JSON.parse(text) : null, content: r.content };
};

// Layers as read from get_metadata on the frame (x, y, width, height in frame pixels).
type R = [name: string, x: number, y: number, w: number, h: number];
const booths: R[] = [];
for (const [rows, x0, yTop] of [
    [['A', 'B'], 140, 640],
    [['C', 'D'], 760, 640],
    [['E', 'F'], 140, 300],
    [['G', 'H'], 760, 300],
] as const) {
    rows.forEach((letter, r) => {
        for (let i = 0; i < 7; i++)
            booths.push([letter + (i + 1), x0 + i * 60, yTop - r * 60, 60, 60]);
    });
}
booths.push(
    ['I1', 600, 580, 120, 120],
    ['I2', 600, 240, 120, 120],
    ['P1', 140, 740, 120, 80],
    ['P2', 1060, 740, 120, 80],
);
const columns: [number, number][] = [
    [354, 524],
    [354, 404],
    [654, 524],
    [654, 404],
    [954, 524],
    [954, 404],
];

const created = await call('create_draft', { name: 'Hall A', kind: 'exhibition' });
const levelId = created.body.document.levels[0].id;
// The "60 m" dimension line runs from x 60 to x 1260; the frame is 1320 × 920.
await call('calibrate', { p1: [60, 28], p2: [1260, 28], distance: 60, size: [1320, 920] });
await call('attach_source', { path: screenshot, ...(FIGMA && { figmaUrl: FIGMA }) });

const toPlan = async (points: [number, number][]) =>
    (await call('source_to_plan', { points })).body as [number, number][];
const rectRing = async (x: number, y: number, w: number, h: number) =>
    toPlan([
        [x, y + h],
        [x + w, y + h],
        [x + w, y],
        [x, y],
    ]);

// Outline: the Floor layer. Walls: the four dark bars, 6 px = 0.3 m, on the Floor's edge.
const corners = await toPlan([
    [60, 860],
    [1260, 860],
    [1260, 60],
    [60, 60],
]);
const commands: Record<string, unknown>[] = [
    { type: 'level.setOutline', levelId, outline: { outer: corners } },
];
const wallIds = ['south', 'east', 'north', 'west'];
wallIds.forEach((id, i) =>
    commands.push({
        type: 'wall.add',
        levelId,
        id,
        a: corners[i],
        b: corners[(i + 1) % 4],
        thickness: 0.3,
    }),
);
// Openings: offset from each wall's start corner along the wall to the Opening's centre (the
// centre of its layer), widths from the layers.
const opening = (id: string, kind: string, wallId: string, offset: number, width: number) =>
    commands.push({
        type: 'opening.add',
        levelId,
        opening: { id, kind, width, host: 'wall', wallId, offset },
    });
opening('entrance-1', 'entrance', 'south', (460 - 60) / 20, 60 / 20);
opening('entrance-2', 'entrance', 'south', (860 - 60) / 20, 60 / 20);
opening('exit-n1', 'emergency-exit', 'north', (1260 - 260) / 20, 36 / 20);
opening('exit-n2', 'emergency-exit', 'north', (1260 - 1060) / 20, 36 / 20);
opening('exit-w', 'emergency-exit', 'west', (260 - 60) / 20, 36 / 20);
opening('exit-e', 'emergency-exit', 'east', (860 - 260) / 20, 36 / 20);
await call('apply_commands', { commands });

const zones: Record<string, unknown>[] = [];
zones.push({
    type: 'zone.add',
    levelId,
    zone: {
        id: 'fire-lane',
        label: 'Fire lane',
        category: 'aisle',
        restricted: true,
        shape: { outer: await rectRing(70, 440, 1180, 60) },
    },
});
zones.push({
    type: 'zone.add',
    levelId,
    zone: {
        id: 'registration',
        label: 'Registration',
        category: 'registration',
        shape: { outer: await rectRing(560, 740, 200, 80) },
    },
});
for (const [label, x, y, w, h] of booths) {
    zones.push({
        type: 'zone.add',
        levelId,
        zone: {
            id: `booth-${label}`,
            label,
            category: 'booth',
            shape: { outer: await rectRing(x, y, w, h) },
        },
    });
}
for (const [i, [x, y]] of columns.entries()) {
    zones.push({
        type: 'obstacle.add',
        levelId,
        obstacle: {
            id: `column-${i + 1}`,
            kind: 'column',
            shape: { outer: await rectRing(x, y, 12, 12) },
        },
    });
}
const applied = await call('apply_commands', { commands: zones });

// What the mock-up does not say for sure.
await call('flag', {
    elementId: 'fire-lane',
    reason: 'Read as a Restricted Zone (aisle) from its name and colour; confirm nothing may be placed there',
    sourceRef: '1:4',
});
await call('flag', {
    elementId: 'exit-w',
    reason: 'Emergency exit read from a green mark on the wall; the mock-up has no door swing',
    sourceRef: '1:144',
});

const preview = await call('render_preview', { width: 1320 });
const image = preview.content.find((c) => c.type === 'image')!;
writeFileSync(`${out}/preview.png`, Buffer.from(image.data!, 'base64'));
await call('save_document', { dir: `${out}/draft`, overwrite: true });
writeFileSync(`${out}/session.log`, log.join('\n') + '\n');
console.log(JSON.stringify(applied.body).slice(0, 400));
await client.close();
