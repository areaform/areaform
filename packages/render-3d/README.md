<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/render-3d

A read-only 3D preview of one Level of an [Areaform](https://github.com/areaform/areaform) Document, drawn with [Three.js](https://threejs.org): Walls with door gaps and lintels, Zones, Obstacles and Stops; orbit, pan, zoom to the pointer, top and ¾ views. Only a Level that changed is rebuilt.

```sh
npm install @areaform/core @areaform/render-3d three
```

```ts
import type { AreaformDocument } from '@areaform/core';
import { createRenderer3D, isWebGLAvailable } from '@areaform/render-3d';

declare const doc: AreaformDocument;
declare const container: HTMLElement;

if (isWebGLAvailable()) {
    const view = await createRenderer3D({ container, doorHeight: 2.2 });
    view.update(doc); // shows the first Level, from a ¾ angle
    view.setView('top');
}
```

`setLines(lines)` draws lines on the floor of a Level, such as a visitor's route: in the scene, so a Wall in front hides them, and as wide on screen at any distance, solid or dashed, with an optional casing under them.

`isHidden(point, height)` tells whether a Wall, an Obstacle or a Stop stands between the camera and a plan point, e.g. to fade a pin placed over the canvas with `toScreen` when it is behind something. A Wall lowered by the cutaway hides only what its kerb does.

`three` is a peer dependency (`>=0.170.0`). In React, `<Areaform3DView>` from [`@areaform/view/react`](https://www.npmjs.com/package/@areaform/view) wraps this. See [the 3D preview](https://github.com/areaform/areaform/blob/main/docs/guides/embedding.md#the-3d-preview).

## License

MIT
