import { expect, type Page } from '@playwright/test';
import { clickAt, documentOf, open, pageAt, routeOnPage, test } from './helpers.ts';

const switchTo = (page: Page, view: '2D' | '3D') =>
    page.getByRole('button', { name: view, exact: true }).click();

const canvas3d = (page: Page) => page.locator('.af-canvas-3d canvas');

/** The 3D canvas once it stops changing: orbit damping has settled and the frame is drawn. */
async function still3d(page: Page): Promise<Buffer> {
    await expect(canvas3d(page)).toBeVisible();
    let last = await canvas3d(page).screenshot();
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(200);
        const next = await canvas3d(page).screenshot();
        if (next.equals(last)) return next;
        last = next;
    }
    throw new Error('the 3D view kept changing');
}

/** The share of pixels that differ between two PNG screenshots of the same size. */
function differingPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
    return page.evaluate(
        async ([a, b]) => {
            const pixels = async (base64: string) => {
                const image = await createImageBitmap(
                    await (await fetch(`data:image/png;base64,${base64}`)).blob(),
                );
                const canvas = new OffscreenCanvas(image.width, image.height);
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                return context.getImageData(0, 0, image.width, image.height).data;
            };
            const [x, y] = [await pixels(a), await pixels(b)];
            let differing = 0;
            for (let i = 0; i < x.length; i += 4) {
                if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) differing++;
            }
            return differing / (x.length / 4);
        },
        [a.toString('base64'), b.toString('base64')] as const,
    );
}

test.describe('3D view', () => {
    // A visual snapshot of the Three.js renderer; refresh it like the 2D ones in view.spec.ts.
    test('sample expo in 3D', async ({ page }) => {
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-3d.png');
    });

    test('booth status and the highlight show in 3D as in 2D', async ({ page }) => {
        await open(page, '&status=1');
        // Selecting a booth highlights it; the 3D view takes both from the same props.
        await clickAt(page, [7.5, 7.5]);
        await switchTo(page, '3D');
        await still3d(page);
        await page.getByRole('button', { name: 'Top view' }).click();
        await still3d(page);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-3d-status.png');
    });

    test('clicking a booth in 3D selects it, as in 2D, and hovering reports it', async ({
        page,
    }) => {
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        const at = (await page.evaluate(() => globalThis.__fp!.toPage3d([7.5, 7.5])))!;

        await page.mouse.move(at.x, at.y);
        await page.mouse.click(at.x, at.y);

        const selected = page.locator('section', { hasText: 'Selected' }).locator('pre');
        await expect(selected).toContainText('"id": "A-1"');
        const events = await page.evaluate(() => globalThis.__fp!.events());
        expect(events.some((e) => e.startsWith('hover:A-1@'))).toBe(true);
        expect(events.some((e) => e.startsWith('click:A-1@'))).toBe(true);
    });

    test('a lowered Wall is picked by its kerb, and a click above it lands behind', async ({
        page,
    }) => {
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        // From the ¾ view the south Wall (ext-0, y = 0) is down to a kerb.
        /** The Element a click at a height over the Wall's middle lands on; `background` for none. */
        const clickAt3d = async (height: number) => {
            const events = () => page.evaluate(() => globalThis.__fp!.events());
            const before = (await events()).length;
            const at = await page.evaluate((h) => globalThis.__fp!.toPage3d([30, 0], h), height);
            await page.mouse.click(at!.x, at!.y);
            // Hover is picked once a frame and may be logged after the click: look for the click.
            return (
                (await events()).slice(before).find((e) => e.startsWith('click:')) ?? 'background'
            );
        };

        expect(await clickAt3d(0.15)).toMatch(/^click:ext-0@/);
        // Where the standing Wall would be, the pointer is on what is beyond it instead.
        expect(await clickAt3d(2.5)).not.toMatch(/ext-0/);
    });

    test('booth names lie on the floor once they are big enough to read', async ({ page }) => {
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        // From the default framing names are under the Theme's smallest label size; zoom in on
        // the A and B rows.
        const box = (await canvas3d(page).boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.62);
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
        await still3d(page);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-3d-labels.png');
    });

    test('a drag turns the camera; Ctrl + drag moves the plan, as the gestures hint says', async ({
        page,
    }) => {
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        const target = async () => (await page.evaluate(() => globalThis.__fp!.camera3d()))!.target;
        const box = (await canvas3d(page).boundingBox())!;
        const drag = async (modifier?: 'Control') => {
            const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
            await page.mouse.move(x, y);
            if (modifier) await page.keyboard.down(modifier);
            await page.mouse.down();
            await page.mouse.move(x + 120, y + 40, { steps: 8 });
            await page.mouse.up();
            if (modifier) await page.keyboard.up(modifier);
            await still3d(page);
        };

        const before = await target();
        await drag();
        // Turning keeps the point it turns around.
        expect(await target()).toEqual(before);
        await drag('Control');
        expect(await target()).not.toEqual(before);
    });

    test('top view looks straight down', async ({ page }) => {
        await open(page);
        await switchTo(page, '3D');
        // Before the renderer is ready the button has nothing to move.
        await still3d(page);
        await page.getByRole('button', { name: 'Top view' }).click();
        await still3d(page);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-3d-top.png');
    });

    test('the 3D camera stays where it was left when switching back from 2D', async ({ page }) => {
        // Three waits for a still frame plus a 3 s hold: on CI's software WebGL that can pass 30 s.
        test.slow();
        await open(page);
        await switchTo(page, '3D');
        await still3d(page);
        const box = (await canvas3d(page).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, {
            steps: 8,
        });
        // Hold still before letting go, so orbit damping has nothing left to coast on.
        await page.waitForTimeout(3000);
        await page.mouse.up();
        const orbited = await still3d(page);

        await switchTo(page, '2D');
        await expect(canvas3d(page)).toHaveCount(0);
        await switchTo(page, '3D');

        // Sub-pixel differences are fine (OrbitControls reports moves above a threshold only);
        // a lost camera would change most of the view.
        expect(await differingPixels(page, await still3d(page), orbited)).toBeLessThan(0.01);
    });

    test('the 2D plan keeps its pan and zoom across a visit to 3D', async ({ page }) => {
        await open(page);
        await page.mouse.move(640, 400);
        await page.mouse.wheel(0, -100);
        const before = await pageAt(page, [10, 0]);

        await switchTo(page, '3D');
        await still3d(page);
        await switchTo(page, '2D');

        expect(await pageAt(page, [10, 0])).toEqual(before);
    });

    for (const [where, query] of [
        ['the View', ''],
        ['the editor', '&mode=edit'],
    ] as const) {
        test(`in ${where}, the 2D plan draws no frames while 3D covers it`, async ({ page }) => {
            // Counts WebGL draws on the 2D canvas only (the one outside the 3D holder).
            await page.addInitScript(() => {
                const g = globalThis as unknown as { __draws2d: number };
                g.__draws2d = 0;
                for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
                    for (const name of ['drawArrays', 'drawElements'] as const) {
                        const draw = C.prototype[name] as (...args: unknown[]) => void;
                        C.prototype[name] = function (
                            this: WebGLRenderingContext,
                            ...args: unknown[]
                        ) {
                            const canvas = this.canvas as HTMLCanvasElement;
                            if (!canvas.closest?.('.af-canvas-3d')) g.__draws2d++;
                            return draw.apply(this, args);
                        } as never;
                    }
                }
            });
            const drawsIn = async (ms: number) => {
                await page.evaluate(() => {
                    (globalThis as unknown as { __draws2d: number }).__draws2d = 0;
                });
                await page.waitForTimeout(ms);
                return page.evaluate(
                    () => (globalThis as unknown as { __draws2d: number }).__draws2d,
                );
            };
            await open(page, query);
            expect(await drawsIn(500)).toBeGreaterThan(0);

            await switchTo(page, '3D');
            await still3d(page);
            expect(await drawsIn(1000)).toBe(0);

            await switchTo(page, '2D');
            await expect.poll(() => drawsIn(300)).toBeGreaterThan(0);
        });
    }

    test('in the editor, a click in 3D selects; drawing tools wait in 2D while edits show up in 3D', async ({
        page,
    }) => {
        await open(page, '&mode=edit');
        const zones = async () => (await documentOf(page)).levels[0]!.zones.length;
        const before = await zones();

        await switchTo(page, '3D');
        const plain = await still3d(page);
        await expect(page.getByRole('button', { name: 'Wall', exact: true })).toBeDisabled();
        const booth = (await page.evaluate(() => globalThis.__fp!.toPage3d([7.5, 7.5])))!;
        await page.mouse.click(booth.x, booth.y);
        await expect
            .poll(() => page.evaluate(() => globalThis.__fp!.events().at(-1)))
            .toBe('selection:1');
        // The selected booth is outlined in the highlight.
        expect((await still3d(page)).equals(plain)).toBe(false);

        await page.locator('.af-editor').press('Delete');
        await expect.poll(zones).toBe(before - 1);

        // Undo brings the booth back but not the selection, as in 2D.
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(zones).toBe(before);
        expect((await still3d(page)).equals(plain)).toBe(true);

        await switchTo(page, '2D');
        await expect(page.getByRole('button', { name: 'Wall', exact: true })).toBeEnabled();
    });
});

test.describe('Viewpoints in the editor (ADR-0025)', () => {
    test('the 3D camera is saved as a Viewpoint, renamed and reordered; the tour plays until the plan is touched', async ({
        page,
    }) => {
        test.slow();
        await open(page, '&mode=edit');
        const viewpoints = async () => (await documentOf(page)).levels[0]!.viewpoints ?? [];
        const section = page.locator('.af-viewpoints');
        await expect(section).toContainText('Open 3D to add viewpoints');

        await switchTo(page, '3D');
        await still3d(page);
        await section.getByRole('button', { name: 'Add this viewpoint' }).click();
        await page.getByRole('button', { name: 'Top view' }).click();
        await still3d(page);
        await section.getByRole('button', { name: 'Add this viewpoint' }).click();
        await expect
            .poll(async () => (await viewpoints()).map((v) => v.name))
            .toEqual(['Viewpoint 1', 'Viewpoint 2']);
        // The angled view looks 45° down; the top view straight down.
        const [angled, top] = await viewpoints();
        expect(angled!.tilt).toBeCloseTo(45, 0);
        expect(top!.tilt).toBeLessThan(1);

        await section.getByLabel('Name of viewpoint 1').fill('Entrance');
        await section.getByLabel('Name of viewpoint 1').press('Enter');
        await section.getByRole('button', { name: 'Earlier in the tour' }).nth(1).click();
        await expect
            .poll(async () => (await viewpoints()).map((v) => v.name))
            .toEqual(['Viewpoint 2', 'Entrance']);

        // From the top view, the tour flies to Viewpoint 2 (the same view), then on to Entrance.
        await section.getByRole('button', { name: 'Play tour' }).click();
        await expect(section.getByRole('button', { name: 'Stop tour' })).toBeVisible();
        const before = await canvas3d(page).screenshot();
        await page.waitForTimeout(4000);
        expect((await canvas3d(page).screenshot()).equals(before)).toBe(false);

        await canvas3d(page).click({ position: { x: 10, y: 10 } });
        await expect(section.getByRole('button', { name: 'Play tour' })).toBeVisible();
        const stopped = await still3d(page);
        await page.waitForTimeout(1000);
        expect((await canvas3d(page).screenshot()).equals(stopped)).toBe(true);

        // In 2D the list stays, without the buttons that need the 3D camera.
        await switchTo(page, '2D');
        await expect(section.getByLabel('Name of viewpoint 2')).toHaveValue('Entrance');
        await expect(section.getByRole('button', { name: 'Go to' })).toHaveCount(0);
        await section.getByRole('button', { name: 'Delete viewpoint 1' }).click();
        await expect.poll(async () => (await viewpoints()).length).toBe(1);
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await viewpoints()).length).toBe(2);
    });
});

test.describe('3D view on phones and weak devices', () => {
    test.describe('with a touch screen', () => {
        test.use({ hasTouch: true });

        /** Real touches through Chromium, so the browser makes pointer events as for a finger. */
        async function touch(page: Page, frames: [number, number][][]) {
            const cdp = await page.context().newCDPSession(page);
            const points = (frame: [number, number][]) => frame.map(([x, y]) => ({ x, y }));
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: points(frames[0]!),
            });
            for (const frame of frames.slice(1))
                await cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: points(frame),
                });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }

        const cameraDistance = async (page: Page) => {
            const camera = (await page.evaluate(() => globalThis.__fp!.camera3d()))!;
            return Math.hypot(...camera.position.map((p, i) => p - camera.target[i]!));
        };

        test('a tap selects a booth', async ({ page }) => {
            await open(page);
            await switchTo(page, '3D');
            await still3d(page);
            const at = (await page.evaluate(() => globalThis.__fp!.toPage3d([7.5, 7.5])))!;

            await page.touchscreen.tap(at.x, at.y);

            const selected = page.locator('section', { hasText: 'Selected' }).locator('pre');
            await expect(selected).toContainText('"id": "A-1"');
        });

        test('one finger orbits and two fingers pinch to zoom, without selecting', async ({
            page,
        }) => {
            // Three waits for a still 3D frame in software WebGL: over 30 s on a CI runner.
            test.slow();
            await open(page);
            await switchTo(page, '3D');
            const start = await still3d(page);
            const box = (await canvas3d(page).boundingBox())!;
            const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
            const far = await cameraDistance(page);

            const steps = Array.from({ length: 10 }, (_, i) => (i + 1) / 10);
            await touch(page, [
                [[cx, cy]],
                ...steps.map((s): [number, number][] => [[cx + 150 * s, cy]]),
            ]);
            const orbited = await still3d(page);
            expect(orbited.equals(start)).toBe(false);

            await touch(page, [
                [
                    [cx - 30, cy],
                    [cx + 30, cy],
                ],
                ...steps.map((s): [number, number][] => [
                    [cx - 30 - 120 * s, cy],
                    [cx + 30 + 120 * s, cy],
                ]),
            ]);
            await still3d(page);
            expect(await cameraDistance(page)).toBeLessThan(far * 0.8);

            // Neither gesture was a tap.
            const selected = page.locator('section', { hasText: 'Selected' });
            await expect(selected.locator('pre')).toHaveCount(0);
        });
    });

    test.describe('on a screen with 3 device pixels per CSS pixel', () => {
        test.use({ deviceScaleFactor: 3 });

        test('draws at most 2 device pixels per CSS pixel', async ({ page }) => {
            // Four times the pixels of the other tests, in software WebGL on CI.
            test.slow();
            await open(page);
            await switchTo(page, '3D');
            await still3d(page);

            const ratio = await canvas3d(page).evaluate(
                (canvas: HTMLCanvasElement) => canvas.width / canvas.clientWidth,
            );
            expect(ratio).toBeCloseTo(2, 1);
        });
    });

    test('draws the plan again when the browser gives back a lost WebGL context', async ({
        page,
    }) => {
        await open(page);
        await switchTo(page, '3D');
        const before = await still3d(page);

        await canvas3d(page).evaluate(async (canvas: HTMLCanvasElement) => {
            const gl = canvas.getContext('webgl2')!;
            const lose = gl.getExtension('WEBGL_lose_context')!;
            lose.loseContext();
            await new Promise((resolve) => setTimeout(resolve, 200));
            lose.restoreContext();
        });

        await expect.poll(async () => (await still3d(page)).equals(before)).toBe(true);
    });
});

test.describe('Content Languages', () => {
    /** Zooms the 3D view in on the A and B rows and the fire lane, as the labels test does. */
    async function zoomOnRows(page: Page) {
        const box = (await canvas3d(page).boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.62);
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
        return still3d(page);
    }

    test('the View shows the plan’s names in the language picked, in 2D', async ({ page }) => {
        await open(page);
        await page.getByLabel('Interface language').selectOption('pl');
        // The View takes the interface language as its Content Language when given none.
        await expect(page.locator('.stage')).toHaveScreenshot('expo-pl.png');
    });

    test('and in 3D, also after a change of language while it is shown', async ({ page }) => {
        await open(page);
        await page.getByLabel('Interface language').selectOption('pl');
        await switchTo(page, '3D');
        await still3d(page);
        const polish = await zoomOnRows(page);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-3d-pl.png');

        // The names are rebuilt for a new language and back, with the camera left where it was.
        await page.getByLabel('Interface language').selectOption('en');
        expect((await still3d(page)).equals(polish)).toBe(false);
        await page.getByLabel('Interface language').selectOption('pl');
        expect(await differingPixels(page, await still3d(page), polish)).toBeLessThan(0.01);
    });
});

/** How many pixels of the route's colour (the View's accent) are within `radius` of a page point. */
async function routePixelsNear(page: Page, at: { x: number; y: number }, radius = 8) {
    const png = await page.screenshot({
        clip: { x: at.x - radius, y: at.y - radius, width: 2 * radius, height: 2 * radius },
        scale: 'css',
    });
    return page.evaluate(async (base64) => {
        const image = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, image.width, image.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
            if (Math.hypot(r - 47, g - 111, b - 219) < 60) count++;
        }
        return count;
    }, png.toString('base64'));
}

test('Wayfinding: in 3D the route is drawn in the scene, on the floor, and moves with it', async ({
    page,
}) => {
    // Two waits for a still frame, one after an orbit whose damping redraws for about 200 frames:
    // on CI's software WebGL that is about four times slower than locally, past 30 s.
    test.slow();
    await open(page, '&here=meeting');
    await clickAt(page, [34.5, 22.5]); // booth D-10
    await page.locator('.af-place-card').getByRole('button', { name: 'Directions' }).click();
    await expect(page.locator('.af-route-panel')).toContainText(/\d+ m · \d+ min/);

    await switchTo(page, '3D');
    await still3d(page);
    // Not over the canvas, where a Wall in front could not hide it: in the scene.
    expect(await routeOnPage(page)).toEqual([]);
    // It leaves the meeting room by its door, at x = 9 in its south Wall (y = 28).
    const door = (await page.evaluate(() => globalThis.__fp!.toPage3d([9, 27.3], 0.05)))!;
    expect(await routePixelsNear(page, door)).toBeGreaterThan(5);
    await expect(page.locator('.af-pin-here')).toBeVisible();
    await expect(page.locator('.af-pin-to')).toBeVisible();

    // Orbiting moves it with the plan.
    const box = (await canvas3d(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await still3d(page);
    const moved = (await page.evaluate(() => globalThis.__fp!.toPage3d([9, 27.3], 0.05)))!;
    expect(Math.hypot(moved.x - door.x, moved.y - door.y)).toBeGreaterThan(10);
    expect(await routePixelsNear(page, moved)).toBeGreaterThan(5);
    if (process.env.WF_SHOT) await page.screenshot({ path: process.env.WF_SHOT });

    // Back in 2D, the route is drawn over the plan again.
    await switchTo(page, '2D');
    await expect.poll(async () => (await routeOnPage(page)).length).toBeGreaterThan(1);
});

test('Wayfinding: in 3D a pin behind a Wall fades; one in sight does not', async ({ page }) => {
    await open(page, '&here=level-1:30,10');
    // North of the hall: seen from the south, behind its north Wall.
    await clickAt(page, [30, 39]);
    await page
        .locator('.af-place-card')
        .getByRole('button', { name: 'Directions to here' })
        .click();
    await expect(page.locator('.af-route-panel')).toContainText(/\d+ m · \d+ min/);
    await expect(page.locator('.af-pin-to')).not.toHaveClass(/af-behind/);

    await switchTo(page, '3D');
    await still3d(page);
    await expect(page.locator('.af-pin-to')).toBeVisible();
    await expect(page.locator('.af-pin-to')).toHaveClass(/af-behind/);
    await expect(page.locator('.af-pin-here')).not.toHaveClass(/af-behind/);
    expect(
        Number(await page.locator('.af-pin-to').evaluate((el) => getComputedStyle(el).opacity)),
    ).toBeLessThan(1);
    if (process.env.WF_SHOT) await page.screenshot({ path: process.env.WF_SHOT });

    // In 2D nothing stands in front of anything.
    await switchTo(page, '2D');
    await expect(page.locator('.af-pin-to')).not.toHaveClass(/af-behind/);
});
