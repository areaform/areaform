import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Fetch } from './figma.ts';
import { DraftError } from './session.ts';
import { loadSourceImage, MAX_IMAGE_BYTES } from './sourceImage.ts';
import { jpeg, png } from './testImages.ts';

const serving =
    (bytes: Uint8Array, status = 200): Fetch =>
    async () => ({
        ok: status < 400,
        status,
        json: async () => ({}),
        arrayBuffer: async () => bytes.slice().buffer,
    });

describe('loadSourceImage', () => {
    it('reads a local PNG or JPEG', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'source-test-')), 'hall.png');
        writeFileSync(file, png(300, 200));
        expect(await loadSourceImage({ path: file })).toEqual({
            file,
            type: 'png',
            size: [300, 200],
        });
    });

    it('explains a file it cannot use', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'source-test-'));
        await expect(loadSourceImage({ path: join(dir, 'gone.png') })).rejects.toThrow(
            /Cannot read/,
        );
        writeFileSync(join(dir, 'notes.png'), 'text');
        await expect(loadSourceImage({ path: join(dir, 'notes.png') })).rejects.toThrow(
            /not a PNG or JPEG/,
        );
    });

    it('takes exactly one of path and url', async () => {
        await expect(loadSourceImage({})).rejects.toThrow(DraftError);
        await expect(loadSourceImage({ path: 'a.png', url: 'https://x/a.png' })).rejects.toThrow(
            'Pass either path or url, not both or neither',
        );
    });

    it('downloads an https image to a new temporary file', async () => {
        const image = jpeg(640, 480);
        const loaded = await loadSourceImage({ url: 'https://example.com/shot' }, serving(image));
        expect(loaded).toMatchObject({ type: 'jpeg', size: [640, 480] });
        expect(basename(loaded.file)).toBe('source.jpg');
        expect(new Uint8Array(readFileSync(loaded.file))).toEqual(image);
    });

    it('refuses what it should not download', async () => {
        const ok = serving(png(10, 10));
        await expect(loadSourceImage({ url: 'http://example.com/a.png' }, ok)).rejects.toThrow(
            'Only https',
        );
        await expect(loadSourceImage({ url: 'file:///etc/hosts' }, ok)).rejects.toThrow(
            'Only https',
        );
        await expect(loadSourceImage({ url: 'not a url' }, ok)).rejects.toThrow('Not a URL');
        await expect(
            loadSourceImage({ url: 'https://example.com/a.png' }, serving(png(10, 10), 403)),
        ).rejects.toThrow('Could not download the image: the server answered 403');
        await expect(
            loadSourceImage(
                { url: 'https://example.com/a.png' },
                serving(new TextEncoder().encode('<html>')),
            ),
        ).rejects.toThrow('did not give a PNG or JPEG');
        const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
        huge.set(png(10, 10));
        await expect(
            loadSourceImage({ url: 'https://example.com/a.png' }, serving(huge)),
        ).rejects.toThrow('over 25 MB');
    });
});
