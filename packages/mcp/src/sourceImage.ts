import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DraftError } from './session.ts';
import { imageInfo, type ImageType } from './source.ts';

/** Larger downloads are refused: a Source image is a screenshot or a scan, not a photo archive. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Redirects followed at most; each new address is checked as the first one was. */
export const MAX_REDIRECTS = 3;

export interface SourceImageFile {
    /** A local file: the one given, or where a download was saved. */
    file: string;
    type: ImageType;
    size: [number, number];
}

/** The part of `fetch` a download uses: redirects come back to be checked, the body is a stream. */
export type ImageFetch = (
    url: string,
    init: { redirect: 'manual' },
) => Promise<{
    status: number;
    headers: { get(name: string): string | null };
    body: ReadableStream<Uint8Array> | null;
}>;

/** Every address a host name resolves to. */
export type Lookup = (hostname: string) => Promise<string[]>;

/** How a download reaches the network; tests stand in for `fetch` and `lookup`. */
export interface ImageDownload {
    fetch?: ImageFetch;
    lookup?: Lookup;
    /**
     * Host names or addresses on this machine or a private network that a download may still
     * reach, such as a company's intranet. From `AREAFORM_MCP_ALLOW_HOSTS` (comma-separated) when
     * absent; empty by default.
     */
    allowHosts?: string[];
}

/** The hosts `AREAFORM_MCP_ALLOW_HOSTS` names, lower-cased. */
export function allowedHostsFromEnv(value = process.env.AREAFORM_MCP_ALLOW_HOSTS): string[] {
    return (value ?? '')
        .split(',')
        .map((host) =>
            host
                .trim()
                .replace(/^\[|\]$/g, '')
                .toLowerCase(),
        )
        .filter(Boolean);
}

const resolveAll: Lookup = async (hostname) =>
    (await dnsLookup(hostname, { all: true })).map((a) => a.address);

// Addresses a download may not reach: this machine, private and shared networks, link-local
// (cloud metadata at 169.254.169.254), multicast and reserved ranges.
const internal = new BlockList();
for (const [net, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
] as const) {
    internal.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
    ['::', 127],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const) {
    internal.addSubnet(net, prefix, 'ipv6');
}

/** Whether a download may not go to this address. */
export function isInternalAddress(address: string): boolean {
    // An IPv4 address written as IPv6 (::ffff:127.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return internal.check(mapped[1]!, 'ipv4');
    const family = isIP(address);
    if (family === 0) return true;
    return internal.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

async function checkHost(url: URL, lookup: Lookup, allowHosts: string[]): Promise<void> {
    if (url.protocol !== 'https:') throw new DraftError('Only https URLs can be downloaded');
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (allowHosts.includes(host)) return;
    let addresses: string[];
    try {
        addresses = isIP(host) ? [host] : await lookup(host);
    } catch {
        throw new DraftError(`Could not download the image: ${host} was not found`);
    }
    const refused = addresses.filter((a) => isInternalAddress(a) && !allowHosts.includes(a));
    if (addresses.length === 0 || refused.length > 0) {
        throw new DraftError(
            `Could not download the image: ${host} is on this machine or a private network ` +
                '(allow it with AREAFORM_MCP_ALLOW_HOSTS)',
        );
    }
}

async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
    if (!body) return new Uint8Array();
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new DraftError(`The image is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    return bytes;
}

/**
 * Downloads an https image: no address on this machine or a private network, at most
 * {@link MAX_REDIRECTS} redirects, each checked again, and never more than {@link MAX_IMAGE_BYTES}
 * read. The name is resolved here and again by `fetch`, so a host that changes its answer between
 * the two can still slip through; this is a local tool, and the check keeps honest mistakes and
 * links planted in a design from reaching internal services.
 */
async function download(
    start: URL,
    { fetch: fetcher, lookup, allowHosts }: Required<ImageDownload>,
) {
    let url = start;
    for (let redirects = 0; ; redirects++) {
        await checkHost(url, lookup, allowHosts);
        let response: Awaited<ReturnType<ImageFetch>>;
        try {
            response = await fetcher(url.href, { redirect: 'manual' });
        } catch (error) {
            throw new DraftError(`Could not download the image: ${(error as Error).message}`);
        }
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
            await response.body?.cancel();
            if (redirects === MAX_REDIRECTS) {
                throw new DraftError(
                    `Could not download the image: more than ${MAX_REDIRECTS} redirects`,
                );
            }
            url = new URL(location, url);
            continue;
        }
        if (response.status < 200 || response.status >= 300) {
            await response.body?.cancel();
            throw new DraftError(
                `Could not download the image: the server answered ${response.status}`,
            );
        }
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_IMAGE_BYTES) {
            await response.body?.cancel();
            throw new DraftError(`The image is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
        }
        try {
            return await readCapped(response.body);
        } catch (error) {
            if (error instanceof DraftError) throw error;
            throw new DraftError(`Could not download the image: ${(error as Error).message}`);
        }
    }
}

/**
 * The Source image as a local file, read from `path` or downloaded from an https `url` (such as
 * the Figma MCP's get_screenshot link, for agents with no shell to download it). A download goes to
 * a new temporary folder; the URL itself is not kept, as such links can grant access.
 */
export async function loadSourceImage(
    from: { path?: string | undefined; url?: string | undefined },
    network: ImageDownload = {},
): Promise<SourceImageFile> {
    if ((from.path === undefined) === (from.url === undefined)) {
        throw new DraftError('Pass either path or url, not both or neither');
    }
    if (from.path !== undefined) {
        const file = resolve(from.path);
        let bytes: Uint8Array;
        try {
            bytes = readFileSync(file);
        } catch {
            throw new DraftError(`Cannot read ${file}`);
        }
        const image = imageInfo(bytes);
        if (!image) throw new DraftError(`${file} is not a PNG or JPEG image`);
        return { file, ...image };
    }

    let url: URL;
    try {
        url = new URL(from.url!);
    } catch {
        throw new DraftError(`Not a URL: ${from.url}`);
    }
    const bytes = await download(url, {
        fetch: network.fetch ?? fetch,
        lookup: network.lookup ?? resolveAll,
        allowHosts: (network.allowHosts ?? allowedHostsFromEnv()).map((h) => h.toLowerCase()),
    });
    const image = imageInfo(bytes);
    if (!image) throw new DraftError('The URL did not give a PNG or JPEG image');
    const file = join(
        mkdtempSync(join(tmpdir(), 'areaform-source-')),
        image.type === 'png' ? 'source.png' : 'source.jpg',
    );
    writeFileSync(file, bytes);
    return { file, ...image };
}
