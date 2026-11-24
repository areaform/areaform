import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DraftError } from './session.ts';
import {
    allowedHostsFromEnv,
    isInternalAddress,
    loadSourceImage,
    MAX_IMAGE_BYTES,
    type ImageDownload,
    type ImageFetch,
} from './sourceImage.ts';
import { jpeg, png } from './testImages.ts';

type Reply = { status?: number; headers?: Record<string, string>; bytes?: Uint8Array };

const stream = (bytes: Uint8Array, chunk = 64 * 1024) =>
    new ReadableStream<Uint8Array>({
        start(controller) {
            for (let at = 0; at < bytes.length; at += chunk) {
                controller.enqueue(bytes.slice(at, at + chunk));
            }
            controller.close();
        },
    });

/** A network where every host is public and each URL answers as given (the last one otherwise). */
function network(replies: Record<string, Reply> | Reply, addresses = ['93.184.215.14']) {
    const asked: string[] = [];
    const fetch: ImageFetch = async (url) => {
        asked.push(url);
        const reply: Reply =
            'status' in replies || 'bytes' in replies || 'headers' in replies
                ? (replies as Reply)
                : ((replies as Record<string, Reply>)[url] ?? { status: 404 });
        const headers = new Map(Object.entries(reply.headers ?? {}));
        return {
            status: reply.status ?? 200,
            headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
            body: stream(reply.bytes ?? new Uint8Array()),
        };
    };
    const download: ImageDownload = { fetch, lookup: async () => addresses };
    return { download, asked };
}

const serving = (bytes: Uint8Array, status = 200) => network({ status, bytes }).download;

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

    it('refuses a declared size over the limit before reading the body', async () => {
        const { download } = network({
            headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) },
            bytes: png(10, 10),
        });
        await expect(
            loadSourceImage({ url: 'https://example.com/a.png' }, download),
        ).rejects.toThrow('over 25 MB');
    });

    it('stops reading once the body passes the limit', async () => {
        let pulled = 0;
        const fetch: ImageFetch = async () => ({
            status: 200,
            headers: { get: () => null },
            body: new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulled++;
                    controller.enqueue(new Uint8Array(1024 * 1024));
                },
            }),
        });
        await expect(
            loadSourceImage(
                { url: 'https://example.com/a.png' },
                { fetch, lookup: async () => ['93.184.215.14'] },
            ),
        ).rejects.toThrow('over 25 MB');
        expect(pulled).toBeLessThanOrEqual(27);
    });

    it('never reaches this machine or a private network', async () => {
        for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '::1']) {
            const { download, asked } = network({ bytes: png(10, 10) }, [address]);
            await expect(
                loadSourceImage({ url: 'https://intranet.example/a.png' }, download),
            ).rejects.toThrow('on this machine or a private network');
            expect(asked).toEqual([]);
        }
        const { download } = network({ bytes: png(10, 10) });
        await expect(loadSourceImage({ url: 'https://[::1]/a.png' }, download)).rejects.toThrow(
            'private network',
        );
        await expect(loadSourceImage({ url: 'https://127.0.0.1/a.png' }, download)).rejects.toThrow(
            'private network',
        );
    });

    it('reaches a private host only when it is allowed', async () => {
        const image = png(10, 10);
        const { download } = network({ bytes: image }, ['192.168.1.10']);
        const byName = { ...download, allowHosts: ['Intranet.Example'] };
        await expect(
            loadSourceImage({ url: 'https://intranet.example/a.png' }, byName),
        ).resolves.toMatchObject({ type: 'png' });
        const byAddress = { ...download, allowHosts: ['192.168.1.10'] };
        await expect(
            loadSourceImage({ url: 'https://nas.example/a.png' }, byAddress),
        ).resolves.toMatchObject({ type: 'png' });
        const other = { ...download, allowHosts: ['intranet.example'] };
        await expect(loadSourceImage({ url: 'https://nas.example/a.png' }, other)).rejects.toThrow(
            'AREAFORM_MCP_ALLOW_HOSTS',
        );
        const http = { ...download, allowHosts: ['intranet.example'] };
        await expect(
            loadSourceImage({ url: 'http://intranet.example/a.png' }, http),
        ).rejects.toThrow('Only https');
    });

    it('reads the allowed hosts from the environment', () => {
        expect(allowedHostsFromEnv(undefined)).toEqual([]);
        expect(allowedHostsFromEnv(' Intranet.Example , 192.168.1.10,,[fd00::1] ')).toEqual([
            'intranet.example',
            '192.168.1.10',
            'fd00::1',
        ]);
    });

    it('follows a few redirects, checking each address', async () => {
        const image = png(20, 10);
        const { download, asked } = network({
            'https://example.com/a': { status: 302, headers: { location: '/b' } },
            'https://example.com/b': {
                status: 301,
                headers: { location: 'https://cdn.example/c' },
            },
            'https://cdn.example/c': { bytes: image },
        });
        const loaded = await loadSourceImage({ url: 'https://example.com/a' }, download);
        expect(loaded).toMatchObject({ type: 'png', size: [20, 10] });
        expect(asked).toEqual([
            'https://example.com/a',
            'https://example.com/b',
            'https://cdn.example/c',
        ]);

        const loop = network({ status: 302, headers: { location: 'https://example.com/again' } });
        await expect(
            loadSourceImage({ url: 'https://example.com/a' }, loop.download),
        ).rejects.toThrow('more than 3 redirects');
        expect(loop.asked).toHaveLength(4);

        const toHttp = network({ status: 302, headers: { location: 'http://example.com/a.png' } });
        await expect(
            loadSourceImage({ url: 'https://example.com/a' }, toHttp.download),
        ).rejects.toThrow('Only https');
    });

    it('tells internal addresses from public ones', () => {
        for (const a of [
            '0.0.0.0',
            '100.64.0.1',
            '172.31.255.255',
            '224.0.0.1',
            '::',
            'fe80::1',
            'fd00::1',
            '::ffff:127.0.0.1',
            'nonsense',
        ]) {
            expect(isInternalAddress(a), a).toBe(true);
        }
        for (const a of [
            '93.184.215.14',
            '172.32.0.1',
            '8.8.8.8',
            '2606:4700::1111',
            '::ffff:8.8.8.8',
        ]) {
            expect(isInternalAddress(a), a).toBe(false);
        }
    });
});
