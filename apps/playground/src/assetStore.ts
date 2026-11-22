// Images imported with a plan (a Draft folder's Source image), kept so the plan's Underlays still
// show after a reload. They are too big for localStorage, so they go to IndexedDB, by Document id.

export interface AssetStore {
    /**
     * Keeps these files for this Document, replacing what it had, and drops the files of every
     * Document not in `keep` (e.g. the plan saved in this browser, if it is another one).
     */
    save(docId: string, files: ReadonlyMap<string, Blob>, keep?: string[]): Promise<void>;
    /** The files kept for this Document, by name; empty if none. */
    load(docId: string): Promise<Map<string, Blob>>;
}

interface Entry {
    docId: string;
    name: string;
    blob: Blob;
}

const keyOf = (docId: string, name: string) => `${docId}/${name}`;

/** In memory, for tests and browsers that block IndexedDB. */
export function memoryAssetStore(): AssetStore {
    const entries = new Map<string, Entry>();
    return {
        async save(docId, files, keep = []) {
            const kept = new Set([...keep]);
            for (const [key, entry] of entries) {
                if (entry.docId === docId || !kept.has(entry.docId)) entries.delete(key);
            }
            for (const [name, blob] of files)
                entries.set(keyOf(docId, name), { docId, name, blob });
        },
        async load(docId) {
            return new Map(
                [...entries.values()].filter((e) => e.docId === docId).map((e) => [e.name, e.blob]),
            );
        },
    };
}

/** IndexedDB, one database per name. */
export function indexedDbAssetStore(name: string): AssetStore {
    const STORE = 'assets';
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    // Rejected on use; until then not an unhandled rejection.
    opened.catch(() => {});
    const run = <T>(
        mode: IDBTransactionMode,
        work: (store: IDBObjectStore, done: (result: T) => void) => void,
    ) =>
        opened.then(
            (db) =>
                new Promise<T>((resolve, reject) => {
                    const tx = db.transaction(STORE, mode);
                    let result: T;
                    work(tx.objectStore(STORE), (r) => (result = r));
                    tx.oncomplete = () => resolve(result);
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                }),
        );
    return {
        save: (docId, files, keep = []) =>
            run<void>('readwrite', (store, done) => {
                // Read and rewrite in one transaction, so two tabs importing at once can't mix.
                const all = store.getAll();
                all.onsuccess = () => {
                    const kept = new Set(keep);
                    for (const entry of all.result as Entry[]) {
                        if (entry.docId === docId || !kept.has(entry.docId)) {
                            store.delete(keyOf(entry.docId, entry.name));
                        }
                    }
                    for (const [name, blob] of files) {
                        store.put({ docId, name, blob } satisfies Entry, keyOf(docId, name));
                    }
                    done(undefined);
                };
            }),
        load: (docId) =>
            run<Map<string, Blob>>('readonly', (store, done) => {
                const all = store.getAll();
                all.onsuccess = () =>
                    done(
                        new Map(
                            (all.result as Entry[])
                                .filter((e) => e.docId === docId)
                                .map((e) => [e.name, e.blob]),
                        ),
                    );
            }),
    };
}

/** IndexedDB where the browser allows it, else memory (the images then last until a reload). */
export function browserAssetStore(): AssetStore {
    try {
        if (typeof indexedDB !== 'undefined')
            return orMemory(indexedDbAssetStore('areaform-playground-assets'));
    } catch {
        // Some browsers throw on merely touching indexedDB with storage blocked.
    }
    return memoryAssetStore();
}

/** `store` until it fails once (others fail only on opening the database), then memory. */
export function orMemory(store: AssetStore): AssetStore {
    const memory = memoryAssetStore();
    let failed = false;
    const either = async <T>(work: (s: AssetStore) => Promise<T>): Promise<T> => {
        if (!failed) {
            try {
                return await work(store);
            } catch {
                failed = true;
            }
        }
        return work(memory);
    };
    return {
        save: (docId, files, keep) => either((s) => s.save(docId, files, keep)),
        load: (docId) => either((s) => s.load(docId)),
    };
}
