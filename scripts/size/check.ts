// How much a site downloads for the engine, and that it stays within budget (`pnpm size`).
//
// Each entry below is a few lines a host would write, bundled by Vite the way a site's build
// would: React external (the host has it), everything else in, dynamic imports split off. Each is
// measured in stages: what loads at once, what loads to draw the 2D plan (the Pixi renderer is a
// dynamic import), and what the first switch to 3D adds (Three.js, also a dynamic import). Sizes
// are gzip and brotli of each file, as a browser downloads them.
//
// It fails when a stage is over its budget in `budget.json`, or when Three.js is in a stage before
// 3D: a static import of `three` somewhere would make every visitor download it.
//
//   node scripts/size/check.ts           check
//   node scripts/size/check.ts --write   set the budgets to today's sizes + 10 %
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build, type Plugin, type Rollup } from 'vite';

const here = new URL('./', import.meta.url);
const root = new URL('../../', import.meta.url);

const entries: Record<string, string> = {
    // The View on a page: what `embed.js` and a host's own site load.
    view: `import { createView } from '@areaform/view';
export const show = (el, doc) => createView(el, { document: doc });`,
    // The Editor in a React app.
    editor: `import { AreaformEditor } from '@areaform/editor/react';
export { AreaformEditor };`,
    // Only the model: reading, checking and changing a plan, no drawing.
    core: `import { createSpace, fromJSON, toJSON } from '@areaform/core';
export { createSpace, fromJSON, toJSON };`,
};

/** `@areaform/<name>/<sub>` as the workspace package's own `exports` map names it (its sources). */
const workspace: Plugin = {
    name: 'areaform-workspace',
    enforce: 'pre',
    resolveId(id) {
        const match = /^@areaform\/([^/]+)(\/.+)?$/.exec(id);
        if (!match) return null;
        const dir = new URL(`packages/${match[1]}/`, root);
        const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
        const target = pkg.exports?.[`.${match[2] ?? ''}`];
        const file = typeof target === 'string' ? target : target?.default;
        return file ? new URL(file, dir).pathname : null;
    },
};

type Stage = 'initial' | 'plan2d' | 'with3d';
type Sizes = Record<Stage, { gzip: number; brotli: number; three: boolean }>;

const isPixi = (chunk: Rollup.OutputChunk) => chunk.fileName.startsWith('pixiRenderer');
const isThreeRenderer = (chunk: Rollup.OutputChunk) => chunk.fileName.startsWith('threeRenderer');
const hasThree = (chunk: Rollup.OutputChunk) =>
    Object.keys(chunk.modules).some((id) =>
        /[\\/]node_modules[\\/](\.pnpm[\\/])?three[@\\/]/.test(id),
    );

async function measure(name: string, source: string): Promise<Sizes> {
    const dir = new URL(`.tmp/${name}/`, here);
    mkdirSync(dir, { recursive: true });
    const entry = new URL('entry.js', dir);
    writeFileSync(entry, source);
    const output = (await build({
        configFile: false,
        logLevel: 'silent',
        root: root.pathname,
        plugins: [workspace],
        build: {
            write: false,
            minify: true,
            lib: { entry: entry.pathname, formats: ['es'], fileName: 'entry' },
            rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] },
        },
    })) as Rollup.RollupOutput[];
    const chunks = output
        .flatMap((o) => o.output)
        .filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
    const byFile = new Map(chunks.map((c) => [c.fileName, c]));

    // A chunk and everything it imports statically.
    const closure = (start: Rollup.OutputChunk[], into = new Set<Rollup.OutputChunk>()) => {
        for (const chunk of start) {
            if (into.has(chunk)) continue;
            into.add(chunk);
            closure(chunk.imports.map((f) => byFile.get(f)!).filter(Boolean), into);
        }
        return into;
    };
    const dynamic = (set: Set<Rollup.OutputChunk>, pick: (c: Rollup.OutputChunk) => boolean) =>
        [...set]
            .flatMap((c) => c.dynamicImports.map((f) => byFile.get(f)!))
            .filter((c) => c && pick(c));

    const initial = closure(chunks.filter((c) => c.isEntry));
    const plan2d = closure(dynamic(initial, isPixi), new Set(initial));
    const with3d = closure(dynamic(plan2d, isThreeRenderer), new Set(plan2d));

    const size = (set: Set<Rollup.OutputChunk>) => ({
        gzip: [...set].reduce((n, c) => n + gzipSync(c.code, { level: 9 }).length, 0),
        brotli: [...set].reduce((n, c) => n + brotliCompressSync(c.code).length, 0),
        three: [...set].some(hasThree),
    });
    return { initial: size(initial), plan2d: size(plan2d), with3d: size(with3d) };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const budgetFile = new URL('budget.json', here);
const budgets = JSON.parse(readFileSync(budgetFile, 'utf8')) as Record<
    string,
    Record<Stage, number>
>;
const write = process.argv.includes('--write');
const failures: string[] = [];
const next: typeof budgets = {};

try {
    for (const [name, source] of Object.entries(entries)) {
        const sizes = await measure(name, source);
        next[name] = {} as Record<Stage, number>;
        for (const stage of ['initial', 'plan2d', 'with3d'] as const) {
            const { gzip, brotli, three } = sizes[stage];
            const budget = budgets[name]?.[stage];
            next[name][stage] = Math.ceil((gzip * 1.1) / 1024) * 1024;
            const over = budget !== undefined && gzip > budget;
            console.log(
                `${name.padEnd(7)} ${stage.padEnd(8)} gzip ${kb(gzip).padStart(9)}  brotli ${kb(brotli).padStart(9)}` +
                    (budget !== undefined ? `  budget ${kb(budget).padStart(9)}` : '') +
                    (over ? '  OVER' : '') +
                    (three ? '  (Three.js)' : ''),
            );
            if (over) failures.push(`${name} ${stage}: ${kb(gzip)} gzip, budget ${kb(budget)}`);
            if (three && stage !== 'with3d') {
                failures.push(`${name} ${stage}: Three.js loads before 3D is asked for`);
            }
        }
    }
} finally {
    rmSync(new URL('.tmp/', here), { recursive: true, force: true });
}

if (write) {
    writeFileSync(budgetFile, JSON.stringify(next, null, 4) + '\n');
    console.log('\nBudgets set to today + 10 %.');
} else if (failures.length) {
    console.error(`\n${failures.join('\n')}`);
    process.exit(1);
}
