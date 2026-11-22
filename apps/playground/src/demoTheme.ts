// The playground's Theme and runtime labels, as a host would set them up. The Theme adds an icon
// for a `sponsor` category: the "A" of our logo (brand/logo.svg) without its frame, since category
// icons are one-colour silhouettes and the frame would turn the whole mark solid.
// `demoLabels` gives the Partner Zone the full-colour logo instead, as a host would an exhibitor's.
import { defaultTheme, type LabelResolver, type Theme } from '@areaform/render-2d';
import logoSvg from '../../../brand/logo.svg?raw';

const areaformMark =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="610 626 712 712">' +
    '<path d="M870 673 H965 V858 L925 960 H754 Z"/>' +
    '<path d="M965 673 H1062 L1178 960 H1006 L965 858 Z"/>' +
    '<path d="M754 960 H921 L792 1292 H620 Z"/>' +
    '<path d="M921 960 H1010 L1067 1106 H864 Z"/>' +
    '<path d="M1010 960 H1178 L1312 1292 H1140 Z"/>' +
    '</svg>';

export const demoTheme: Theme = {
    ...defaultTheme,
    categories: {
        ...defaultTheme.categories,
        sponsor: { fill: '#dbe6f4', stroke: '#1f6fc9' },
    },
    categoryIcons: { ...defaultTheme.categoryIcons, sponsor: areaformMark },
};

/**
 * The plan as a host would show it at runtime: the partner's full-colour logo, which a category
 * icon could not carry. The editor shows it too (logos only, never runtime names).
 */
export const demoLabels: LabelResolver = (zone) =>
    zone.id === 'partner' ? { logo: logoSvg } : undefined;
