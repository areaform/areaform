<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/core

The model and editing core of [Areaform](https://github.com/areaform/areaform), an embeddable engine for modelling physical places: exhibition halls, offices, stores, warehouses, flats. A **Document** describes one Space; every change is a serialisable **Command** with undo/redo, checked by **Invariants**. No framework or DOM dependencies, so it also runs on a server.

```sh
npm install @areaform/core
```

```ts
import { createEditor, createSpace, fromJSON, toJSON } from '@areaform/core';

const editor = createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] }));
const levelId = editor.getDocument().levels[0]!.id;

const result = editor.exec({
    type: 'zone.add',
    levelId,
    zone: {
        label: 'A-1',
        category: 'booth',
        shape: {
            outer: [
                [5, 5],
                [8, 5],
                [8, 8],
                [5, 8],
            ],
        },
    },
});
if (!result.ok) console.error(result.errors); // rejected by an Invariant; nothing changed

const json = toJSON(editor.getDocument());
const loaded = fromJSON(json); // never throws; upgrades older Documents
if (loaded.ok) console.log(loaded.doc.name);
```

- [Embedding guide](https://github.com/areaform/areaform/blob/main/docs/guides/embedding.md): Documents, Commands, syncing with a backend, Diagnostics
- [Domain vocabulary](https://github.com/areaform/areaform/blob/main/CONTEXT.md): Space, Level, Wall Node, Zone, Connection, …

## License

MIT
