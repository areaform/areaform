// Scores an imported Draft against the plan it was drawn from:
//   node packages/mcp/eval/score.ts packages/mcp/eval/demo-hall.json <draft>/plan.json
import { fromJSON, type AreaformDocument } from '@areaform/core';
import { readFileSync } from 'node:fs';
import { score } from '../src/score.ts';

const load = (path: string): AreaformDocument => {
    const loaded = fromJSON(readFileSync(path, 'utf8'));
    if (!loaded.ok) throw new Error(`${path}: ${JSON.stringify(loaded.errors)}`);
    return loaded.doc;
};

const [expectedPath, foundPath] = process.argv.slice(2);
if (!expectedPath || !foundPath) {
    console.error('Usage: node packages/mcp/eval/score.ts <expected.json> <found.json>');
    process.exit(1);
}
const result = score(load(expectedPath).levels[0]!, load(foundPath).levels[0]!);
console.log(JSON.stringify(result, null, 2));
