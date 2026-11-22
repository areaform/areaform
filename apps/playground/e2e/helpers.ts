import { test as base, expect, type Page } from '@playwright/test';
import { deflateSync, inflateSync } from 'node:zlib';
import type { AreaformDocument, Vec2 } from '@areaform/core';

interface TestHook {
    getDocument(): AreaformDocument | null;
    toPage(point: Vec2): { x: number; y: number };
    /** Page coordinates of a plan point at a height in the 3D view; null when none is shown. */
    toPage3d(point: Vec2, height?: number): { x: number; y: number } | null;
    /** The 3D camera, while a 3D view is shown. */
    camera3d(): { position: number[]; target: number[] } | null;
    /** Editor events since the canvas mounted: `tool:wall`, `level:<id>`, `selection:2`. */
    events(): string[];
    /** Names of the imported images the plan shows now, e.g. `source.png`. */
    assets(): string[];
}
declare global {
    var __fp: TestHook | undefined;
}

/**
 * The tests' `test`: every sidebar section open on a page's first load, as most tests were written
 * that way (a new visitor sees only Properties open). Later reloads keep whatever the test left, and
 * a test that wants the visitor's defaults uses Playwright's own `test`.
 */
export const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem('e2e:sections-opened')) return;
            sessionStorage.setItem('e2e:sections-opened', '1');
            const key = 'areaform:playground:prefs';
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, JSON.stringify({ foldedSections: [] }));
            }
        });
        await use(page);
    },
});

/**
 * Opens the playground on the Expo demo, which most tests are written against, with the test hook,
 * and waits for the canvas to be ready.
 */
export async function open(page: Page, query = '') {
    await openAsSaved(page, `&sample=expo${query}`);
}

/**
 * Opens the playground as a person would: on the saved plan, or else the Office demo. For a test
 * that reloads to see what was saved, since a `?sample=` page opens its demo again on every reload.
 */
export async function openAsSaved(page: Page, query = '') {
    await page.goto(`/?e2e=1${query}`);
    await ready(page);
}

export async function ready(page: Page) {
    await page.waitForFunction(() => globalThis.__fp !== undefined);
}

export async function documentOf(page: Page): Promise<AreaformDocument> {
    const doc = await page.evaluate(() => globalThis.__fp!.getDocument());
    expect(doc, 'the page exposes a Document').not.toBeNull();
    return doc!;
}

/** Page coordinates of a plan point (metres) on the current Level. */
export function pageAt(page: Page, point: Vec2) {
    return page.evaluate((p) => globalThis.__fp!.toPage(p), point);
}

export async function clickAt(page: Page, point: Vec2) {
    const { x, y } = await pageAt(page, point);
    await page.mouse.click(x, y);
}

export async function dragAt(page: Page, from: Vec2, to: Vec2) {
    const a = await pageAt(page, from);
    const b = await pageAt(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
}

/** A PNG of one colour, `width` × `height` px, e.g. an Underlay image for a test. */
export function solidPng(
    width: number,
    height: number,
    [r, g, b]: [number, number, number],
): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    const row = Buffer.concat([
        Buffer.from([0]),
        Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat()),
    ]);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** The colour on screen at a plan point (metres) of the current Level, as `[r, g, b]`. */
export async function colourAt(page: Page, point: Vec2): Promise<[number, number, number]> {
    const { x, y } = await pageAt(page, point);
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' });
    // One pixel: its only row is a filter byte and the pixel, unchanged by any filter since
    // nothing comes before it. The compressed data may be split across several IDAT chunks.
    const data: Buffer[] = [];
    for (let at = 8; at < png.length;) {
        const length = png.readUInt32BE(at);
        if (png.toString('ascii', at + 4, at + 8) === 'IDAT')
            data.push(png.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    const [, red, green, blue] = inflateSync(Buffer.concat(data));
    return [red!, green!, blue!];
}

function crc32(data: Buffer) {
    let crc = ~0;
    for (const byte of data) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

/**
 * The Wayfinding route line's points on the page, in order (an `M` starts a new run where the line
 * breaks in 3D), or none while no route is drawn.
 */
export async function routeOnPage(page: Page): Promise<{ x: number; y: number }[]> {
    const line = page.locator('path.af-route');
    if (!(await line.isVisible())) return [];
    const box = (await page.locator('.af-overlay').boundingBox())!;
    const d = (await line.getAttribute('d')) ?? '';
    return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x: box.x + Number(m[1]),
        y: box.y + Number(m[2]),
    }));
}

/** Picks an item from one of the top bar's menus (Demos, File), opening it first. */
export async function fromMenu(page: Page, menu: 'Demos' | 'File', item: string | RegExp) {
    await page.getByRole('button', { name: menu, exact: true }).click();
    await page.getByRole('menu', { name: menu }).getByRole('menuitem', { name: item }).click();
}

/** Opens a demo from the Demos menu; its item starts with the demo's name. */
export async function loadDemo(page: Page, name: 'Office' | 'Expo' | 'Stress') {
    await fromMenu(page, 'Demos', new RegExp(`^${name}\\b`));
}
