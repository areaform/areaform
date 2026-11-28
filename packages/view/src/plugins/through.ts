// A Through route (CONTEXT.md): from Here in the outer Space, through a fitted Inner Space's
// entrance, to a place inside it. When the View shows a shop's plan laid into its unit, the two
// share coordinates, so the outer plan with the shop's ground floor merged in (`withInnerSpace`)
// carries one route. Wayfinding keeps one `Through` per unit gone into, and asks it what to route
// on and what to draw where.
import {
    containsPoint,
    textIn,
    withInnerSpace,
    type AreaformDocument,
    type Shape,
    type Vec2,
} from '@areaform/core';
import type { NavMesh } from '@areaform/wayfinding';
import type { InnerUnit } from '../view.ts';

/** A point on a Level, as Wayfinding keeps Here and a route's place. */
interface LevelPoint {
    levelId: string;
    point: Vec2;
}

export interface Through {
    /** The unit on the host's plan, its Zone and Level. */
    unit: InnerUnit;
    /** The shop's ground floor, the Level shown inside. */
    shopLevelId: string;
    /** The shop's name, for "Enter Volt". */
    name: string;
    unitShape: Shape;
    /** Here in the centre when the visitor went in. */
    from: LevelPoint | null;
    /** The shop's plan, laid in. */
    shop: AreaformDocument;
    /** The host's plan the merged one was made from, to make it again once the host's changes. */
    home: AreaformDocument;
    /** The host's plan with the shop's ground floor in, and its navmeshes as they are built. */
    doc: AreaformDocument;
    meshes: Map<string, NavMesh>;
}

/** The Through for a unit gone into, or null when its shop is not laid in or the unit is gone. */
export function throughOf(
    home: AreaformDocument,
    unit: InnerUnit,
    shop: AreaformDocument,
    shopLevelId: string,
    from: LevelPoint | null,
    language: string | undefined,
): Through | null {
    if (!unit.fitted) return null;
    const unitShape = home.levels
        .find((l) => l.id === unit.levelId)
        ?.zones.find((z) => z.id === unit.zoneId)?.shape;
    if (!unitShape) return null;
    return {
        unit,
        shopLevelId,
        name: textIn(shop.name, shop.names, shop.languages, language) ?? shop.name,
        unitShape,
        from,
        shop,
        home,
        doc: withInnerSpace(home, unit, shop),
        meshes: new Map(),
    };
}

/** The merged plan to route on, made again if the host's plan changed since. */
export function routePlan(through: Through, home: AreaformDocument): AreaformDocument {
    if (through.home !== home) {
        through.home = home;
        through.doc = withInnerSpace(home, through.unit, through.shop);
        through.meshes.clear();
    }
    return through.doc;
}

/** Whether a place on `levelId` is on the shop's floor, where a Through route can go. */
export const onShopFloor = (through: Through, levelId: string) => levelId === through.shopLevelId;

/** The same place as the Through route goes to it: on the unit's Level of the host's plan. */
export const throughPlace = <P extends LevelPoint>(through: Through, place: P) => ({
    ...place,
    levelId: through.unit.levelId,
    through: through.unit.zoneId,
});

/**
 * Whether what stands on `levelId` is shown on `shownLevel`: the same Level, or, inside a shop,
 * the unit's Level of the host's plan, which the shop's floor lies on.
 */
export function shownOn(inside: Through | null, levelId: string, shownLevel: string): boolean {
    return (
        levelId === shownLevel ||
        (inside !== null && levelId === inside.unit.levelId && shownLevel === inside.shopLevelId)
    );
}

/** A leg as drawn inside a shop: from where it comes into the unit. Elsewhere, all of it. */
export function shownPoints(inside: Through | null, leg: { levelId: string; points: Vec2[] }) {
    if (!inside || leg.levelId !== inside.unit.levelId) return leg.points;
    const first = leg.points.findIndex((p) => containsPoint(inside.unitShape, p));
    return first < 0 ? [] : leg.points.slice(Math.max(0, first - 1));
}

/** The scene's Level for a leg in 3D: inside a shop, the shop's floor for the unit's Level. */
export const sceneLevel = (inside: Through | null, levelId: string) =>
    inside && levelId === inside.unit.levelId ? inside.shopLevelId : levelId;
