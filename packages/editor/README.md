<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/editor

The editor of [Areaform](https://github.com/areaform/areaform): drawing tools (Walls, Openings, Zones, Outlines, calibration), snapping, selection and clipboard in a framework-free controller, and the ready-made `<AreaformEditor>` React component for authoring. The read-only View for visitors is [`@areaform/view`](https://www.npmjs.com/package/@areaform/view).

```sh
npm install @areaform/core @areaform/editor react three
```

```tsx
import { createEditor, createSpace, toJSON, type Editor } from '@areaform/core';
import { AreaformEditor } from '@areaform/editor/react';
import '@areaform/editor/styles.css';
import { useEffect, useState } from 'react';

declare function saveToMyBackend(json: string): void;

export function HallEditor() {
    const [editor] = useState<Editor>(() =>
        createEditor(createSpace({ name: 'Hall A', kind: 'exhibition', size: [60, 36] })),
    );
    useEffect(() => editor.on('change', (doc) => saveToMyBackend(toJSON(doc))), [editor]);

    return (
        <div style={{ height: '100vh' }}>
            <AreaformEditor editor={editor} units="metric" />
        </div>
    );
}
```

The components fill their parent, so give it a height. `react` (19) is a peer dependency; `three` is only downloaded when someone switches to 3D.

See the [embedding guide](https://github.com/areaform/areaform/blob/main/docs/guides/embedding.md) for every prop, theming, and use without React.

## License

[Business Source License 1.1](LICENSE): free in production, including in sites and apps you build for clients; offering it, or a plan builder made with it, as a product or hosted service needs a commercial licence. Each version becomes MIT two years after its release.
