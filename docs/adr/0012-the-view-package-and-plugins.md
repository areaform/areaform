---
status: accepted
---

# `@areaform/view`: a framework-free View with a thin React wrapper, extended by Plugins

The View shows a Space to visitors. It was a React component inside `@areaform/editor`, which is not MIT, and a site without React needs it through `embed.js`. So the View moves to its own MIT package, `@areaform/view`, and is written in plain TypeScript: `createView(container, options)` mounts the 2D renderer, loads the 3D one on demand, draws the plan controls (**2D / 3D**, **Show grid**, **Top view**, **Angled view**, **Fit**), remembers the 3D camera between switches, forwards clicks and hovers from either view, and shows the Space's text in the visitor's Content Language ([ADR-0011](0011-content-languages-in-the-document.md)). It returns a `View` with a setter for each option and `on(event, handler)`. `@areaform/view/react` wraps it: `<AreaformView>` and `<Areaform3DView>` create a View when they mount and call its setters when props change, so there is one implementation, and `embed.js` uses the core without shipping React.

The Editor depends on the View, never the reverse, because MIT code cannot depend on the Editor's. What both need lives in the View and the Editor imports it: the interface translator and the texts visitors see (plan controls, units, Zone Category and Connection kind names), the display units, the button icons and the plan controls. The Editor keeps its own texts and lays them over the View's, so one translator serves it. The Editor's canvas wrappers, which edit, stay in the Editor.

## Plugins

The View's base stays small: show, pan, zoom, click, hover, highlight. Everything else a Space can show visitors (a tooltip card, a link on click, search, Wayfinding) is a Plugin, loaded only when used:

```ts
type ViewPlugin = (context: PluginContext) => void | (() => void);

interface PluginContext {
    view: View; // events, the Document, the Level shown, languages, toScreen
    overlay: HTMLElement; // a layer over the plan for the Plugin's own elements
    i18n: Translator;
}

createView(container, { plugins: [tooltip(), { load: () => import('./search.ts') }] });
```

A Plugin is a function given the View, an overlay element over the plan and the translator; it subscribes to what it needs and returns a cleanup. It is passed as is, or as a loader, `{ load: () => import(…) }`, that imports it on first use, so a Space that never shows search never downloads it. `view.use(plugin)` adds one later. The first Plugin, the tooltip card (Free plan), proves the contract: it shows the hovered Element's name in the visitor's language and its category, near the pointer, and a host can give its own content.

Which Plugins a Space loads can come from its data rather than from the site's code: `embed.js` maps Plugin names to loaders.

## Considered Options

- **Move the React components as they are, write a vanilla View for `embed.js` later.** Less work now, but two implementations for a while and a second move later.
- **Copy the shared pieces into each package.** No dependency between them, but every fix twice, and the copies drift.
- **A Plugin contract without a Plugin.** Quick, but untested until Wayfinding or analytics, and likely to change then.
- **Plugins as classes with lifecycle methods.** More ceremony than a function returning its cleanup, for no gain yet.

## Consequences

- `<AreaformView>` and `<Areaform3DView>` move from `@areaform/editor/react` to `@areaform/view/react`. Nothing has been published, so there is no compatibility export.
- The translator becomes generic over its dictionary: the View's has the visitors' texts, the Editor's adds its own, and a host's `messages` can change either.
- Hosts import `@areaform/view/styles.css` for the View, and the Editor's stylesheet for the Editor, which includes the View's.
- A Plugin sees only the public `View`, so anything it needs (`toScreen` in both views, the hovered Element) is public API, and a third-party Plugin can do what ours do.
