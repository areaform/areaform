// The part of @kninnug/constrainautor @areaform/wayfinding uses, mapped in tsconfig.base.json for every
// package that imports it: the package's own types are its TypeScript source, which does not compile
// under this repository's strict settings.
declare module '@kninnug/constrainautor' {
    export interface DelaunatorLike {
        coords: { readonly length: number; readonly [n: number]: number };
        triangles: { readonly length: number; [n: number]: number };
        halfedges: { readonly length: number; [n: number]: number };
        hull: { readonly length: number; readonly [n: number]: number };
    }

    export default class Constrainautor {
        constructor(del: DelaunatorLike, edges?: readonly [number, number][]);
        constrainOne(segP1: number, segP2: number): number;
        constrainAll(edges: readonly [number, number][]): this;
        isConstrained(edg: number): boolean;
    }
}
