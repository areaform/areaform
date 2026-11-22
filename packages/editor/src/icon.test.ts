import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, iconNames } from './react/Icon.tsx';

describe('Icon', () => {
    it.each(iconNames)('draws %s as an SVG hidden from assistive technology', (name) => {
        const svg = renderToStaticMarkup(createElement(Icon, { name }));
        expect(svg).toMatch(
            /^<svg [^>]*aria-hidden="true"[^>]*><(path|rect|circle) [\s\S]*<\/svg>$/,
        );
        expect(svg).toContain('stroke="currentColor"');
    });

    it('draws a different glyph for every name', () => {
        const svgs = iconNames.map((name) => renderToStaticMarkup(createElement(Icon, { name })));
        expect(new Set(svgs).size).toBe(iconNames.length);
    });
});
