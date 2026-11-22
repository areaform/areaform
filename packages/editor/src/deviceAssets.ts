// Images kept in this browser instead of uploaded (ADR-0016): an Underlay's `src` is then
// `local:<id>`, and only a browser that kept the file can show it.

const PREFIX = 'local:';
const STORE = 'files';

/** Whether an Underlay's image is kept on a device rather than at a URL. */
export const isDeviceAsset = (src: string) => src.startsWith(PREFIX);

export interface DeviceAssets {
    /** Keeps a file in this browser and returns its `src`; pass it as `keepAsset`. */
    keep(file: Blob): Promise<string>;
    /** Reads back the kept files among these sources, e.g. a Document's Underlays, before showing it. */
    load(sources: Iterable<string>): Promise<void>;
    /** A URL for a file kept or read back here; undefined for any other `src`. Use it in `resolveAsset`. */
    url(src: string): string | undefined;
}

/** Device images in IndexedDB, in a database of this name. */
export function createDeviceAssets(name = 'areaform-device-assets'): DeviceAssets {
    const urls = new Map<string, string>();
    let opened: Promise<IDBDatabase> | undefined;
    const database = () =>
        (opened ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }));
    const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) =>
        database().then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const request = work(db.transaction(STORE, mode).objectStore(STORE));
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                }),
        );

    return {
        async keep(file) {
            const src = `${PREFIX}${crypto.randomUUID()}`;
            await run('readwrite', (store) => store.put(file, src));
            urls.set(src, URL.createObjectURL(file));
            return src;
        },
        async load(sources) {
            for (const src of new Set(sources)) {
                if (!isDeviceAsset(src) || urls.has(src)) continue;
                // A file this browser does not have, or unreadable storage, leaves it unresolved.
                const file = await run<Blob | undefined>('readonly', (store) =>
                    store.get(src),
                ).catch(() => undefined);
                if (file) urls.set(src, URL.createObjectURL(file));
            }
        },
        url: (src) => urls.get(src),
    };
}
