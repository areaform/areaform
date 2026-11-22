import { describe, expect, it } from 'vitest';
import { compactJSON } from './compactJSON.ts';

describe('compactJSON', () => {
    it('puts points and lists of points on one line each', () => {
        const booth = {
            id: 'D-3',
            shape: {
                outer: [
                    [12, 21],
                    [15, 21],
                    [15, 24],
                    [12, 24],
                ],
            },
            data: { status: 'reserved' },
        };
        expect(compactJSON(booth)).toBe(
            [
                '{',
                '  "id": "D-3",',
                '  "shape": {',
                '    "outer": [[12, 21], [15, 21], [15, 24], [12, 24]]',
                '  },',
                '  "data": {',
                '    "status": "reserved"',
                '  }',
                '}',
            ].join('\n'),
        );
    });

    it('leaves lists of objects one item to a line, and reads back the same', () => {
        const value = {
            holes: [
                {
                    outer: [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                    ],
                },
            ],
            tags: ['a', 'b'],
            empty: [],
        };
        const text = compactJSON(value);
        expect(text).toContain('"tags": ["a", "b"]');
        expect(text).toContain('"outer": [[0, 0], [1, 0], [1, 1]]');
        expect(text).toContain('"holes": [\n    {');
        expect(JSON.parse(text)).toEqual(value);
    });
});
