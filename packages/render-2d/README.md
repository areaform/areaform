<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/render-2d

The 2D renderer of [Areaform](https://github.com/areaform/areaform): draws an Areaform Document with [PixiJS](https://pixijs.com) v8, with camera, hit-testing, Element events, Style Overrides and a theme. PixiJS is loaded on the first `createRenderer` call, so bundlers put it in its own chunk.

```sh
npm install @areaform/core @areaform/render-2d
```

```ts
import type { AreaformDocument } from '@areaform/core';
import { createRenderer } from '@areaform/render-2d';

declare const doc: AreaformDocument;
declare const container: HTMLElement;

const renderer = await createRenderer({ container, interaction: 'view' });
renderer.update(doc);
renderer.setLevel(doc.levels[0]!.id);
renderer.fitLevel();

renderer.on('elementClick', (e) => console.log(e.ref.kind, e.ref.id, e.point));
```

For a ready-made React view and editor, use [`@areaform/editor`](https://www.npmjs.com/package/@areaform/editor). See the [embedding guide](https://github.com/areaform/areaform/blob/main/docs/guides/embedding.md) for theming and the full API.

## License

MIT
