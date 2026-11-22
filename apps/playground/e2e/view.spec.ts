import { expect, type Page } from '@playwright/test';
import { clickAt, open, pageAt, routeOnPage, test } from './helpers.ts';

test('clicking a booth selects it and shows its data', async ({ page }) => {
    await open(page);

    await clickAt(page, [7.5, 7.5]);

    const selected = page.locator('section', { hasText: 'Selected' }).locator('pre');
    await expect(selected).toContainText('"id": "A-1"');
    await expect(selected).toContainText('"status"');
});

test('clicks and hovers report where on the canvas they happened', async ({ page }) => {
    await open(page);
    const canvas = (await page.locator('.af-view canvas').boundingBox())!;
    const { x, y } = await pageAt(page, [7.5, 7.5]);
    const at = `${Math.round(x - canvas.x)},${Math.round(y - canvas.y)}`;

    await page.mouse.move(x, y);
    await page.mouse.click(x, y);

    const events = await page.evaluate(() => globalThis.__fp!.events());
    expect(events).toContain(`hover:A-1@${at}`);
    expect(events).toContain(`click:A-1@${at}`);
});

test.describe('rendering', () => {
    // Visual snapshots of the Pixi renderer (R4). Baselines live next to this file; refresh them
    // with `pnpm e2e --update-snapshots=all` after an intended visual change.
    test('sample expo', async ({ page }) => {
        await open(page);
        await page.waitForTimeout(500);
        await expect(page.locator('.stage')).toHaveScreenshot('expo.png');
    });

    test('booth status Style Override', async ({ page }) => {
        await open(page, '&status=1');
        await page.waitForTimeout(500);
        await expect(page.locator('.stage')).toHaveScreenshot('expo-status.png');
    });

    test('editor with the grid shown', async ({ page }) => {
        await open(page, '&mode=edit');
        await page.getByRole('button', { name: 'Show grid' }).click();
        await page.waitForTimeout(500);
        await expect(page.locator('.af-editor')).toHaveScreenshot('editor-grid.png');
    });

    test('rulers and the origin mark come with the grid', async ({ page }) => {
        await open(page, '&mode=edit');
        await page.getByRole('button', { name: 'Show grid' }).click();
        await page.waitForTimeout(500);
        // The corner where the rulers meet, and the origin at the Outline's corner, up close:
        // small enough that the whole-editor tolerance cannot hide a change.
        const canvas = (await page.locator('.af-editor canvas').first().boundingBox())!;
        await expect(page).toHaveScreenshot('editor-rulers.png', {
            clip: { x: canvas.x, y: canvas.y, width: 240, height: canvas.height },
        });
    });

    test('editor with a selection', async ({ page }) => {
        await open(page, '&mode=edit');
        await clickAt(page, [7.5, 7.5]);
        await page.waitForTimeout(500);
        await expect(page.locator('.af-editor')).toHaveScreenshot('editor-selected.png');
    });

    test('editor with always-on dimensions', async ({ page }) => {
        await open(page, '&mode=edit');
        const toggle = page.getByRole('button', { name: 'Dimensions' });
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(500);
        await expect(page.locator('.af-editor')).toHaveScreenshot('editor-dimensions.png');
    });
});

test('a sideways trackpad scroll pans; the mouse wheel and a pinch (Ctrl + wheel) zoom', async ({
    page,
}) => {
    await open(page);
    const span = async () => {
        const [a, b] = [await pageAt(page, [0, 0]), await pageAt(page, [10, 0])];
        return { x: a.x, width: b.x - a.x };
    };
    await page.mouse.move(640, 400);
    const before = await span();

    await page.mouse.wheel(60, 0);
    await expect.poll(async () => (await span()).x).toBeCloseTo(before.x - 60, 0);
    expect((await span()).width).toBeCloseTo(before.width, 3);

    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await span()).width).toBeGreaterThan(before.width);

    const zoomed = (await span()).width;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 20);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await span()).width).toBeLessThan(zoomed);
});

test('the tooltip Plugin names the booth under the pointer, in the language picked', async ({
    page,
}) => {
    await open(page);
    const tooltip = page.getByRole('tooltip');
    const booth = await pageAt(page, [7.5, 7.5]);

    await page.mouse.move(booth.x, booth.y);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('A-1Booth');
    // It follows the pointer across the booth.
    const before = (await tooltip.boundingBox())!;
    await page.mouse.move(booth.x + 20, booth.y + 10);
    await expect.poll(async () => (await tooltip.boundingBox())!.x).toBeCloseTo(before.x + 20, 0);

    // Off every Element, it goes.
    const outside = await pageAt(page, [3, 12]);
    await page.mouse.move(outside.x, outside.y);
    await expect(tooltip).toBeHidden();

    await page.getByLabel('Interface language').selectOption('pl');
    const cafe = await pageAt(page, [51, 29.5]);
    await page.mouse.move(cafe.x, cafe.y);
    await expect(tooltip).toHaveText('Kawiarnia');
});

const panel = (page: import('@playwright/test').Page) => page.locator('.af-route-panel');

test('Wayfinding: Directions asks where you are, then draws the route there', async ({ page }) => {
    await open(page);

    // A tap on a booth opens its card; Directions without a Here asks for one.
    await clickAt(page, [7.5, 7.5]);
    const card = page.locator('.af-place-card');
    await expect(card).toContainText('A-1');
    await card.getByRole('button', { name: 'Directions', exact: true }).click();
    await expect(card).toBeHidden();
    await expect(panel(page)).toContainText('To A-1');
    await expect(panel(page)).toContainText('Where are you?');

    // A tap on the plan is Here: the pin, the route and how far it is.
    await clickAt(page, [15, 3]);
    await expect(page.locator('.af-pin-here')).toBeVisible();
    await expect(panel(page)).toContainText(/^To A-1\d+ m · \d+ min/);
    await expect(page.locator('.af-pin-to')).toBeVisible();
    const route = await routeOnPage(page);
    expect(route.length).toBeGreaterThanOrEqual(2);
    const start = await pageAt(page, [15, 3]);
    expect(Math.hypot(route[0]!.x - start.x, route[0]!.y - start.y)).toBeLessThan(2);

    // The line moves with the plan.
    const outside = await pageAt(page, [3, 12]);
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.down();
    await page.mouse.move(outside.x + 80, outside.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await routeOnPage(page))[0]!.x).toBeCloseTo(route[0]!.x + 80, 0);

    // Change start: the next tap is the new Here.
    await panel(page).getByRole('button', { name: 'Change start' }).click();
    await expect(panel(page)).toContainText('Where are you?');
    await panel(page).getByLabel('Pick a place').selectOption({ label: 'Café' });
    await expect(panel(page)).toContainText(/\d+ m · \d+ min/);

    // Clear route: the line, the destination and the panel go; Here stays.
    await panel(page).getByRole('button', { name: 'Clear route' }).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('.af-pin-to')).toBeHidden();
    expect(await routeOnPage(page)).toEqual([]);
    await expect(page.locator('.af-pin-here')).toBeVisible();
});

test('Wayfinding: ?here= starts in a room, and the route leaves it through its door', async ({
    page,
}) => {
    await open(page, '&here=meeting');
    await expect(page.locator('.af-pin-here')).toContainText('You are here');

    await clickAt(page, [34.5, 22.5]); // booth D-10
    await page.locator('.af-place-card').getByRole('button', { name: 'Directions' }).click();
    await expect(panel(page)).toContainText(/To D-10\d+ m · \d+ min/);

    // The meeting room's only way out is its door, 1 m wide at x = 9 in its south Wall (y = 28).
    const route = await routeOnPage(page);
    const door = await pageAt(page, [9, 28]);
    const zoom = (await pageAt(page, [1, 0])).x - (await pageAt(page, [0, 0])).x;
    const nearDoor = route.some((p) => Math.hypot(p.x - door.x, p.y - door.y) < 0.8 * zoom);
    expect(nearDoor).toBe(true);
    // It ends beside the booth (D-10 is 33–36 × 21–24 m), not inside it.
    const end = route.at(-1)!;
    const [sw, ne] = [await pageAt(page, [33, 21]), await pageAt(page, [36, 24])];
    const inside = end.x > sw.x + 1 && end.x < ne.x - 1 && end.y < sw.y - 1 && end.y > ne.y + 1;
    expect(inside).toBe(false);
    expect(Math.min(Math.abs(end.x - ne.x), Math.abs(end.y - ne.y))).toBeLessThan(0.5 * zoom);
});

test('Wayfinding: Step-free takes the Lift instead of the stairs', async ({ page }) => {
    await open(page, '&here=lounge');
    // It opens on the gallery, where the visitor stands; the booth is on Level 1.
    await expect(page.locator('.af-pin-here')).toBeVisible();
    await page.getByRole('button', { name: 'Level 1', exact: true }).click();
    await expect(page.locator('.af-pin-here')).toBeHidden();
    await clickAt(page, [7.5, 7.5]); // booth A-1 on Level 1
    await page.locator('.af-place-card').getByRole('button', { name: 'Directions' }).click();
    const steps = panel(page).getByRole('list', { name: 'Steps' }).getByRole('button');
    await expect(steps).toHaveText(['Take Main stairs down to Level 1']);
    const stepFree = panel(page).getByRole('checkbox', { name: 'Step-free' });
    await expect(stepFree).not.toBeChecked();

    await stepFree.check();
    await expect(steps).toHaveText(['Take Lift down to Level 1']);
    await expect(page.locator('.af-route-change', { hasText: '↓ Level 1' })).toBeVisible();
    await expect(stepFree).toBeChecked();
    await expect(stepFree).toBeFocused();

    await stepFree.uncheck();
    await expect(steps).toHaveText(['Take Main stairs down to Level 1']);
});

test('Wayfinding: a route from the gallery goes down to Level 1, shown a Level at a time', async ({
    page,
}) => {
    await open(page, '&here=lounge');
    await expect(page.locator('.af-pin-here')).toBeVisible();
    await page.getByRole('button', { name: 'Level 1', exact: true }).click();
    await expect(page.locator('.af-pin-here')).toBeHidden();
    await clickAt(page, [7.5, 7.5]); // booth A-1 on Level 1
    await page.locator('.af-place-card').getByRole('button', { name: 'Directions' }).click();
    await expect(panel(page)).toContainText(/To A-1\d+ m · \d+ min/);
    const steps = panel(page).getByRole('list', { name: 'Steps' }).getByRole('button');
    await expect(steps).toHaveText([/^Take (Main stairs|Lift) down to Level 1$/]);

    // Shown from its start: Here on the gallery and the way to the Connection, not the destination.
    const here = page.locator('.af-pin-here');
    const to = page.locator('.af-pin-to');
    await expect(here).toBeVisible();
    await expect(to).toBeHidden();
    expect((await routeOnPage(page)).length).toBeGreaterThanOrEqual(2);
    await expect(steps).toHaveAttribute('aria-current', 'step');

    // The marker where the route goes down shows the rest of it on Level 1.
    await page.locator('.af-route-change', { hasText: '↓ Level 1' }).click();
    await expect(to).toBeVisible();
    await expect(here).toBeHidden();
    await expect(page.locator('.af-route-change', { hasText: 'From Gallery' })).toBeVisible();
    await expect(steps).not.toHaveAttribute('aria-current', 'step');
    const route = await routeOnPage(page);
    const booth = await pageAt(page, [7.5, 7.5]);
    const zoom = (await pageAt(page, [1, 0])).x - (await pageAt(page, [0, 0])).x;
    const end = route.at(-1)!;
    expect(Math.hypot(end.x - booth.x, end.y - booth.y)).toBeLessThan(3 * zoom);

    // A step goes back to where it starts.
    await steps.first().click();
    await expect(here).toBeVisible();
});

test.describe('Wayfinding: a link with Here opens on its Level', () => {
    const shown = (page: Page) =>
        page.locator('.panel section:has(h2:text-is("Level")) [aria-pressed="true"]');

    test('a point on the gallery', async ({ page }) => {
        await open(page, `&here=${encodeURIComponent('gallery:34,24')}`);
        await expect(shown(page)).toHaveText('Gallery');
        await expect(page.locator('.af-pin-here')).toBeVisible();
    });

    test("a Zone's id, on its Level", async ({ page }) => {
        await open(page, '&here=services-cafe');
        await expect(shown(page)).toHaveText('Services');
        await expect(page.locator('.af-pin-here')).toBeVisible();
    });

    test('a Level the plan has not, or a spot outside the building: the ground floor', async ({
        page,
    }) => {
        for (const here of ['unsupportedFloor:3,4', 'nowhere', 'gallery:34;24', 'gallery:30,10']) {
            await open(page, `&here=${encodeURIComponent(here)}`);
            await page.waitForTimeout(300);
            await expect(shown(page)).toHaveText('Level 1');
            await expect(page.locator('.af-pin-here')).toBeHidden();
        }
    });
});

test.describe('Wayfinding: a link to one place (?to=)', () => {
    const shown = (page: Page) =>
        page.locator('.panel section:has(h2:text-is("Level")) [aria-pressed="true"]');

    test('with Here: the route at once, across Levels, shown from its start', async ({ page }) => {
        await open(page, '&here=lounge&to=A-1');
        await expect(panel(page)).toContainText(/To A-1\d+ m · \d+ min/);
        await expect(shown(page)).toHaveText('Gallery');
        await expect(page.locator('.af-pin-here')).toBeVisible();
        const steps = panel(page).getByRole('list', { name: 'Steps' }).getByRole('button');
        await expect(steps).toHaveText([/^Take (Main stairs|Lift) down to Level 1$/]);
    });

    test('without Here: its Level, with its card open', async ({ page }) => {
        await open(page, '&to=lounge');
        await expect(shown(page)).toHaveText('Gallery');
        const card = page.locator('.af-place-card');
        await expect(card).toContainText('VIP lounge');
        await expect(card.getByRole('button', { name: 'Directions' })).toBeVisible();
    });

    test('an id the plan has not: nothing opens', async ({ page }) => {
        await open(page, '&to=nowhere');
        await page.waitForTimeout(300);
        await expect(shown(page)).toHaveText('Level 1');
        await expect(page.locator('.af-place-card')).toBeHidden();
    });
});

test('Wayfinding: a place outside is reached by the nearest entrance, then a dotted line on', async ({
    page,
}) => {
    await open(page, '&here=level-1:40,10');
    // South of the hall, nearer the west entrance (x = 15) than the east one (x = 45) it leaves by.
    await clickAt(page, [36, -2]);
    const card = page.locator('.af-place-card');
    await card.getByRole('button', { name: 'Directions to here' }).click();
    await expect(panel(page)).toContainText(/\d+ m · \d+ min/);

    const zoom = (await pageAt(page, [1, 0])).x - (await pageAt(page, [0, 0])).x;
    const end = (await routeOnPage(page)).at(-1)!;
    const door = await pageAt(page, [45, 0]);
    expect(Math.hypot(end.x - door.x, end.y - door.y)).toBeLessThan(2 * zoom);

    // The dotted line runs on from the door to the place, and the pin stands there.
    const box = (await page.locator('.af-overlay').boundingBox())!;
    const d = (await page.locator('path.af-route-beyond').getAttribute('d')) ?? '';
    const dots = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x: box.x + Number(m[1]),
        y: box.y + Number(m[2]),
    }));
    const place = await pageAt(page, [36, -2]);
    expect(Math.hypot(dots[0]!.x - end.x, dots[0]!.y - end.y)).toBeLessThan(1);
    expect(Math.hypot(dots.at(-1)!.x - place.x, dots.at(-1)!.y - place.y)).toBeLessThan(1);
    const pin = (await page.locator('.af-pin-to').boundingBox())!;
    expect(Math.abs(pin.x + pin.width / 2 - place.x)).toBeLessThan(0.5 * zoom);
    // The plan moved so the end is in view above the route panel, which would hide it.
    const shown = (await panel(page).boundingBox())!;
    expect(pin.y + pin.height).toBeLessThan(shown.y);
    expect(dots.every((p) => p.y < shown.y)).toBe(true);
});

test('Wayfinding: Here is never outside the building', async ({ page }) => {
    // An old link outside is left out: the Plugin asks again.
    await open(page, '&here=level-1:30,-2');
    await expect(page.locator('.af-pin-here')).toBeHidden();

    await clickAt(page, [7.5, 7.5]); // booth A-1
    await page.locator('.af-place-card').getByRole('button', { name: 'Directions' }).click();
    await clickAt(page, [-2, 18]); // west of the hall: the panel covers the south
    await expect(panel(page)).toContainText('Pick a spot inside the building.');
    await expect(page.locator('.af-pin-here')).toBeHidden();

    await clickAt(page, [15, 3]);
    await expect(page.locator('.af-pin-here')).toBeVisible();
    await expect(panel(page)).toContainText(/To A-1\d+ m · \d+ min/);
    await expect(panel(page)).not.toContainText('Pick a spot inside');
});

test('Wayfinding: the dotted line to a place behind the building goes round it', async ({
    page,
}) => {
    await open(page, '&here=level-1:30,10');
    // North of the hall; its entrances are both in the south Wall.
    await clickAt(page, [30, 39]);
    await page
        .locator('.af-place-card')
        .getByRole('button', { name: 'Directions to here' })
        .click();
    await expect(panel(page)).toContainText(/\d+ m · \d+ min/);

    const box = (await page.locator('.af-overlay').boundingBox())!;
    const d = (await page.locator('path.af-route-beyond').getAttribute('d')) ?? '';
    const dots = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
        x: box.x + Number(m[1]),
        y: box.y + Number(m[2]),
    }));
    expect(dots.length).toBeGreaterThan(3);
    // Nowhere along it is inside the hall (0–60 × 0–36 m), the doorway it starts in apart.
    const [sw, ne] = [await pageAt(page, [0, 0]), await pageAt(page, [60, 36])];
    const zoom = (await pageAt(page, [1, 0])).x - (await pageAt(page, [0, 0])).x;
    const inHall = (p: { x: number; y: number }) =>
        p.x > sw.x + zoom && p.x < ne.x - zoom && p.y < sw.y - zoom && p.y > ne.y + zoom;
    for (let i = 1; i < dots.length; i++)
        for (let k = 0; k <= 20; k++) {
            const [a, b] = [dots[i - 1]!, dots[i]!];
            expect(
                inHall({ x: a.x + ((b.x - a.x) * k) / 20, y: a.y + ((b.y - a.y) * k) / 20 }),
            ).toBe(false);
        }
    const place = await pageAt(page, [30, 39]);
    expect(Math.hypot(dots.at(-1)!.x - place.x, dots.at(-1)!.y - place.y)).toBeLessThan(1);
});
