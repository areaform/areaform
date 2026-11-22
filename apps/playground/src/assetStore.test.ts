import { describe, expect, it } from 'vitest';
import { memoryAssetStore, orMemory, type AssetStore } from './assetStore.ts';

const png = (text: string) => new Blob([text], { type: 'image/png' });

describe('memoryAssetStore', () => {
    it('keeps the files of a Document by name', async () => {
        const store = memoryAssetStore();
        const source = png('hall');
        await store.save('doc-1', new Map([['source.png', source]]));
        expect(await store.load('doc-1')).toEqual(new Map([['source.png', source]]));
        expect(await store.load('doc-2')).toEqual(new Map());
    });

    it("replaces a Document's files and drops other Documents' unless kept", async () => {
        const store = memoryAssetStore();
        await store.save('saved', new Map([['source.png', png('saved')]]));
        await store.save('old', new Map([['source.png', png('old')]]), ['saved']);
        await store.save('old', new Map([['scan.jpg', png('new')]]), ['saved']);
        expect([...(await store.load('old')).keys()]).toEqual(['scan.jpg']);
        // `saved` was kept; nothing else but `old` remains.
        expect([...(await store.load('saved')).keys()]).toEqual(['source.png']);
        await store.save('third', new Map());
        expect(await store.load('saved')).toEqual(new Map());
        expect(await store.load('old')).toEqual(new Map());
    });
});

describe('orMemory', () => {
    it('keeps the files in memory once the store fails, e.g. IndexedDB refusing to open', async () => {
        const refused = Promise.reject(new Error('blocked'));
        refused.catch(() => {});
        const broken: AssetStore = { save: () => refused, load: () => refused };
        const store = orMemory(broken);
        const source = png('hall');
        await store.save('doc-1', new Map([['source.png', source]]));
        expect(await store.load('doc-1')).toEqual(new Map([['source.png', source]]));
    });
});
