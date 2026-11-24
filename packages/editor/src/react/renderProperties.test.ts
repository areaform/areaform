import { createEditor, createSpace } from '@areaform/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AreaformEditor, type PropertiesContext } from './index.ts';

describe('AreaformEditor renderProperties', () => {
    it("shows the host's fields in the sidebar, with the Level shown and the selection", () => {
        const editor = createEditor(
            createSpace({ name: 'Hall', kind: 'exhibition', size: [20, 10] }),
        );
        const seen: PropertiesContext[] = [];

        const html = renderToStaticMarkup(
            createElement(AreaformEditor, {
                editor,
                renderProperties: (context) => {
                    seen.push(context);
                    return createElement('p', null, `Price for ${context.level.name}`);
                },
            }),
        );

        expect(html).toContain('<div class="af-host-properties"><p>Price for Level 1</p></div>');
        expect(seen[0]).toMatchObject({ selection: [], doc: editor.getDocument(), editor });
    });
});
