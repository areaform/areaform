import type { Shape, Vec2 } from '@areaform/core';
import type { Style } from './theme.ts';

/** Transient editor graphics drawn above the plan: previews, guides, snap markers and labels. */
export type OverlayItem =
    | { type: 'line'; points: Vec2[]; closed?: boolean; style: Style }
    | { type: 'polygon'; shape: Shape; style: Style }
    | {
          type: 'marker';
          position: Vec2;
          /** What the pointer snapped to; drawn with a different symbol per kind. */
          kind: 'node' | 'vertex' | 'edge' | 'grid' | 'angle';
          style: Style;
      }
    /** Text at a plan position, drawn at a fixed screen size on a light backing (e.g. dimensions). */
    | { type: 'label'; position: Vec2; text: string };
