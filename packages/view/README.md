<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/view

The View of [Areaform](https://github.com/areaform/areaform): a Space shown to visitors. Pan, zoom, click, hover and highlight in 2D, a 3D view on demand, the plan controls, Style Overrides, runtime names and logos, and the Space's text in the visitor's Content Language. Plain TypeScript, with a React wrapper and Plugins loaded only when used.

```sh
npm install @areaform/core @areaform/view three
```

```ts
import { createView } from '@areaform/view';
import '@areaform/view/styles.css';

const view = createView(container, { doc, controls: true, locale: 'pl' });
view.on('elementClick', (e) => showBooth(e.ref.id));
```

In React:

```tsx
import { AreaformView } from '@areaform/view/react';

<AreaformView
    doc={doc}
    controls
    plugins={[{ load: () => import('@areaform/view/plugins/tooltip').then((m) => m.tooltip()) }]}
/>;
```

`react` is an optional peer dependency, needed only for `@areaform/view/react`. See [the embedding guide](https://github.com/areaform/areaform/blob/main/docs/guides/embedding.md#showing-a-space-areaformview).

## License

MIT
