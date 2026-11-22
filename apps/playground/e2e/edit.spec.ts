import { underlayToWorld, zoneAt } from '@areaform/core';
import { expect } from '@playwright/test';
import {
    clickAt,
    colourAt,
    documentOf,
    dragAt,
    fromMenu,
    open,
    openAsSaved,
    pageAt,
    ready,
    solidPng,
    test,
} from './helpers.ts';

test('create a Space, draw a room, add a door and an elevator, undo, save and reload', async ({
    page,
}) => {
    await openAsSaved(page, '&mode=edit');
    await page.evaluate(() => localStorage.clear());

    // The creation wizard: kind, size and grid step.
    await fromMenu(page, 'File', 'New Space…');
    const form = page.getByRole('form', { name: 'Create space' });
    await form.getByLabel('Name').fill('Test office');
    await form.getByLabel('Kind').selectOption('office');
    await form.getByLabel('Width, m').fill('20');
    await form.getByLabel('Depth, m').fill('12');
    await form.getByLabel('Grid step, m').fill('1');
    await form.getByRole('button', { name: 'Create' }).click();
    // The new Space mounts a fresh editor and canvas; wait until the hook reports it.
    await expect.poll(() => documentOf(page).then((d) => d.name)).toBe('Test office');
    expect(await documentOf(page)).toMatchObject({
        name: 'Test office',
        kind: 'office',
        grid: { step: 1 },
    });

    // A room: four clicks and back to the start closes it.
    await page.getByRole('button', { name: 'Wall', exact: true }).click();
    for (const point of [
        [2, 2],
        [10, 2],
        [10, 8],
        [2, 8],
        [2, 2],
    ] as [number, number][]) {
        await clickAt(page, point);
    }
    let doc = await documentOf(page);
    expect(doc.levels[0]!.walls).toHaveLength(4);
    expect(doc.levels[0]!.wallNodes).toHaveLength(4);

    // A door on the south wall, using the keyboard shortcut for the tool.
    await page.keyboard.press('d');
    await clickAt(page, [6, 2]);
    doc = await documentOf(page);
    expect(doc.levels[0]!.openings).toEqual([
        expect.objectContaining({ kind: 'door', host: 'wall' }),
    ]);

    // A second Level, then an elevator between the two.
    await page.getByRole('button', { name: '+ Level', exact: true }).click();
    await page.getByRole('button', { name: 'Connection' }).click();
    await page.getByLabel('Connection kind').selectOption('elevator');
    await dragAt(page, [14, 3], [16, 5]);
    doc = await documentOf(page);
    expect(doc.connections).toEqual([expect.objectContaining({ kind: 'elevator' })]);
    expect(doc.connections[0]!.stops).toHaveLength(2);

    // Undo and redo.
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await documentOf(page)).connections).toEqual([]);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect((await documentOf(page)).connections).toHaveLength(1);

    // Save, reload the page: the saved Space opens again.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    const saved = await documentOf(page);
    await page.reload();
    await ready(page);
    expect(await documentOf(page)).toEqual(saved);
});

test('deleting a Wall that hosts a door asks for confirmation first', async ({ page }) => {
    await open(page, '&mode=edit');
    const roomWall = () =>
        documentOf(page).then((d) => d.levels[0]!.walls.filter((w) => w.id === 'room-s'));

    await clickAt(page, [4, 28]);
    await page.keyboard.press('Delete');

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('also deletes 1 opening');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await roomWall()).toHaveLength(1);

    await clickAt(page, [4, 28]);
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    expect(await roomWall()).toEqual([]);
    expect((await documentOf(page)).levels[0]!.openings.map((o) => o.id)).not.toContain(
        'room-door',
    );
});

test('dragging a booth moves it by whole grid steps, as one undo step', async ({ page }) => {
    await open(page, '&mode=edit');
    const booth = () =>
        documentOf(page).then((d) => d.levels[0]!.zones.find((z) => z.id === 'A-1')!);
    const before = (await booth()).shape.outer;

    await dragAt(page, [7.5, 7.5], [7.5, 10.6]);

    expect((await booth()).shape.outer).toEqual(before.map(([x, y]) => [x, y + 3]));
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await booth()).shape.outer).toEqual(before);
});

test('walls generated from the Outline join the walls drawn inside it', async ({ page }) => {
    await open(page, '&mode=edit');
    await fromMenu(page, 'File', 'New Space…');
    const form = page.getByRole('form', { name: 'Create space' });
    await form.getByLabel('Name').fill('Walled');
    await form.getByLabel('Width, m').fill('20');
    await form.getByLabel('Depth, m').fill('12');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => documentOf(page).then((d) => d.name)).toBe('Walled');

    // An inner wall touching the south edge, drawn first.
    await page.getByRole('button', { name: 'Wall', exact: true }).click();
    await clickAt(page, [8, 0]);
    await clickAt(page, [8, 6]);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByLabel('Wall thickness in metres').fill('0.25');
    await page.getByRole('button', { name: 'Walls from outline' }).click();

    const level = (await documentOf(page)).levels[0]!;
    // The south edge is split where the inner wall meets it: 5 outline walls + 1 inner.
    expect(level.walls).toHaveLength(6);
    expect(level.walls.filter((w) => w.thickness === 0.25)).toHaveLength(5);

    await page.getByRole('button', { name: 'Walls from outline' }).click();
    await expect(page.getByText('The Outline already has walls.')).toBeVisible();
});

test('duplicating a Level offers to extend its Connections; moving it re-stacks elevations', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const levels = async () =>
        [...(await documentOf(page)).levels]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((l) => `${l.name}@${l.elevation}`);

    // Level 1 (0 m, 6 m ceiling) has the Lift and the Main stairs; the Gallery sits at 6 m and
    // the Services basement at −4 m.
    await page.getByRole('button', { name: 'Duplicate' }).click();
    expect(await levels()).toEqual(['Services@-4', 'Level 1@0', 'Gallery@6', 'Level 1 copy@10']);
    await expect(page.getByLabel('Level name')).toHaveValue('Level 1 copy');

    const offer = page.getByRole('group', { name: 'Extend connections' });
    // Selecting something on the copy keeps the offer.
    await clickAt(page, [7.5, 7.5]);
    await expect(page.getByLabel('Level name')).toHaveCount(0); // a booth is selected
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Extend Lift' }).click();
    await offer.getByRole('button', { name: 'Done' }).click();
    await expect(offer).toHaveCount(0);
    // Done hands the focus back to the editor, so Esc deselects the booth: back to the Level panel.
    await page.keyboard.press('Escape');
    const doc = await documentOf(page);
    const stopsOf = (name: string) => doc.connections.find((c) => c.name === name)!.stops.length;
    expect(stopsOf('Lift')).toBe(4);
    expect(stopsOf('Main stairs')).toBe(2);

    // Move the copy below the Gallery: it takes 6 m and the Gallery sits on top of it.
    await page.getByRole('button', { name: 'Move down' }).click();
    expect(await levels()).toEqual(['Services@-4', 'Level 1@0', 'Level 1 copy@6', 'Gallery@12']);
    await expect(
        page
            .locator('.af-sidebar section', { has: page.getByRole('heading', { name: 'Levels' }) })
            // Under the heading, which is a button too (it folds the section).
            .locator('.af-section-body')
            .getByRole('button'),
    ).toHaveText(['+ Level', 'Gallery', 'Level 1 copy', 'Level 1', 'Services', '+ Level below']);
    await expect(page.getByRole('button', { name: 'Move down' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await levels()).toEqual(['Services@-4', 'Level 1@0', 'Gallery@6', 'Level 1 copy@10']);
});

test('a one-way Connection shows which way it runs, and Reverse turns it round', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await clickAt(page, [42, 17.5]); // the Main stairs' Stop on Level 1
    const row = (caption: string) => page.locator(`.af-props dt:text-is("${caption}") + dd`);
    await expect(row('Runs')).toHaveCount(0);
    await row('Two-way').getByRole('checkbox').uncheck();
    await expect(row('Runs')).toContainText('Level 1 → Gallery');
    await row('Runs').getByRole('button', { name: 'Reverse' }).click();
    await expect(row('Runs')).toContainText('Gallery → Level 1');
    const stairs = (await documentOf(page)).connections.find((c) => c.id === 'stairs')!;
    expect(stairs.bidirectional).toBe(false);
    expect(stairs.stops.map((s) => s.levelId)).toEqual(['gallery', 'level-1']);
});

test('R turns the selected booth a quarter; the handle turns it in 15° steps', async ({ page }) => {
    await open(page, '&mode=edit');
    const booth = () =>
        documentOf(page).then((d) => d.levels[0]!.zones.find((z) => z.id === 'A-1')!.shape.outer);
    const before = await booth();

    await clickAt(page, [7.5, 7.5]);
    await page.keyboard.press('r');
    // A 3 × 3 booth turned about its own centre covers the same square, starting from another corner.
    const turned = await booth();
    expect(turned).not.toEqual(before);
    expect([...turned].sort()).toEqual([...before].sort());
    await page.keyboard.press('Shift+R');
    expect(await booth()).toEqual(before);

    // The handle would sit above the frame, on booth B-1's name, so it sits left of it instead
    // (centre y, 24 px left of the left edge at x = 6).
    const zoom = await page.evaluate(() => {
        const a = globalThis.__fp!.toPage([0, 0]);
        const b = globalThis.__fp!.toPage([1, 0]);
        return b.x - a.x;
    });
    const handle = 6 - 24 / zoom;
    const radius = 7.5 - handle;
    const at = (degrees: number): [number, number] => {
        const r = ((180 + degrees) * Math.PI) / 180;
        return [7.5 + radius * Math.cos(r), 7.5 + radius * Math.sin(r)];
    };
    await dragAt(page, [handle, 7.5], at(44));
    // 44° snaps to 45°: the booth becomes a diamond around its centre.
    const diamond = await booth();
    const xs = diamond.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3 * Math.SQRT2, 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await booth()).toEqual(before);
});

test('the Outline tool adds a hole (an atrium) and edits its corners', async ({ page }) => {
    await open(page, '&mode=edit');
    const holes = () => documentOf(page).then((d) => d.levels[0]!.outline.holes ?? []);

    await page.getByRole('button', { name: 'Outline', exact: true }).click();
    await page.getByRole('button', { name: 'Add hole' }).click();
    await dragAt(page, [16, 28], [24, 33]);

    expect(await holes()).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Edit corners' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    await dragAt(page, [24, 33], [26, 34]);
    expect((await holes())[0]).toContainEqual([26, 34]);
});

// The dimension labels themselves are drawn on the canvas; their text is covered by the
// controller tests and their look by the editor screenshot baseline.
test('the Ruler measures without changing the Document', async ({ page }) => {
    await open(page, '&mode=edit');

    // The Ruler measures between snapped points without changing the Document.
    const before = await documentOf(page);
    await page.getByRole('button', { name: 'Ruler' }).click();
    await dragAt(page, [40, 2], [43.1, 5.9]);
    expect(await documentOf(page)).toEqual(before);
});

test('Level Groups get their own heading in the switcher; + Level adds to the current group', async ({
    page,
}) => {
    await open(page, '&mode=edit');

    const group = page.getByLabel('Level group');
    await group.fill('Hall A');
    await group.press('Enter');

    const hallA = page.getByRole('group', { name: 'Hall A' });
    const ungrouped = page.getByRole('group', { name: 'No group' });
    await expect(hallA.getByRole('button')).toHaveText(['Level 1']);
    await expect(ungrouped.getByRole('button')).toHaveText(['Gallery', 'Services']);

    await page.getByRole('button', { name: '+ Level', exact: true }).click();
    // Named after the count of Levels: the sample has three.
    await expect(hallA.getByRole('button')).toHaveText(['Level 4', 'Level 1']);
    const added = (await documentOf(page)).levels.find((l) => l.name === 'Level 4')!;
    // On top of Hall A (Level 1: 0 m, 6 m ceiling), even though the Gallery also has ordinal 1.
    expect(added).toMatchObject({ group: 'Hall A', ordinal: 1, elevation: 6 });
});

test('+ Level below adds a basement under the ground floor', async ({ page }) => {
    await open(page, '&mode=edit');

    await page.getByRole('button', { name: '+ Level below' }).click();
    await page.getByRole('button', { name: '+ Level below' }).click();

    const levels = [...(await documentOf(page)).levels]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((l) => `${l.name}@${l.ordinal}:${l.elevation}`);
    // The sample's Services basement is 4 m tall, so each new basement goes 4 m further down, named
    // by its place in the stack.
    expect(levels).toEqual([
        'Basement 3@-3:-12',
        'Basement 2@-2:-8',
        'Services@-1:-4',
        'Level 1@0:0',
        'Gallery@1:6',
    ]);
    await expect(
        page
            .locator('.af-sidebar section', { has: page.getByRole('heading', { name: 'Levels' }) })
            // Under the heading, which is a button too (it folds the section).
            .locator('.af-section-body')
            .getByRole('button'),
    ).toHaveText([
        '+ Level',
        'Gallery',
        'Level 1',
        'Services',
        'Basement 2',
        'Basement 3',
        '+ Level below',
    ]);
});

test('the editor reports tool, Level and selection changes to the host', async ({ page }) => {
    await open(page, '&mode=edit');
    const gallery = (await documentOf(page)).levels.find((l) => l.name === 'Gallery')!;

    await page.getByRole('button', { name: 'Wall', exact: true }).click();
    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.getByRole('button', { name: 'Select', exact: true }).click();

    await expect
        .poll(() => page.evaluate(() => globalThis.__fp!.events()))
        .toEqual(['tool:wall', 'level:' + gallery.id, 'tool:select']);
});

test('an unlocked Underlay can be dragged on the canvas; a locked one stays put', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.getByLabel('Underlay image URL').fill('/sample-underlay.svg');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const underlay = async () =>
        (await documentOf(page)).levels.find((l) => l.id === 'gallery')!.underlays[0];
    // Placed at the Outline's top-left (0, 36); 1000 × 500 px at 0.02 m per pixel is 20 × 10 m.
    await expect.poll(async () => (await underlay())?.size).toEqual([1000, 500]);
    expect((await underlay())!.position).toEqual([0, 36]);

    // y 34–36 is clear of the VIP lounge, so the drag lands on the Underlay.
    await dragAt(page, [10, 35], [13, 33]);
    await expect.poll(async () => (await underlay())!.position).toEqual([3, 34]);

    // Now x 3–23, y 24–34; only x 3–4 is clear of the lounge (x 4–24, y 24–34).
    await page.getByLabel('Locked').check();
    const lounge = async () =>
        (await documentOf(page)).levels.find((l) => l.id === 'gallery')!.zones[0]!.shape;
    const loungeBefore = await lounge();
    await dragAt(page, [3.5, 30], [3.5, 27]);
    expect((await underlay())!.position).toEqual([3, 34]);
    expect(await lounge()).toEqual(loungeBefore);
});

test('an Underlay image shows on the plan, also from a URL without a file extension', async ({
    page,
}) => {
    // Many image URLs have no extension (a server's asset, a CDN's photo); Pixi picks a loader
    // by it, so without one the Underlay used to stay blank while the Document looked right.
    await page.route('**/plan-image', (route) =>
        route.fulfill({ body: solidPng(1000, 500, [224, 32, 32]), contentType: 'image/png' }),
    );
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Gallery' }).click();
    // y 34–36 is clear of the VIP lounge; the Underlay covers x 0–20, y 26–36 at 50% opacity.
    const floor = await colourAt(page, [10, 35]);
    await page.getByLabel('Underlay image URL').fill('/plan-image');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect.poll(() => colourAt(page, [10, 35])).not.toEqual(floor);
    const [r, g, b] = await colourAt(page, [10, 35]);
    expect(r - Math.max(g, b)).toBeGreaterThan(60);
});

test('dragging an Underlay corner resizes the image drawn, keeping its proportions', async ({
    page,
}) => {
    await page.route('**/plan-image', (route) =>
        route.fulfill({ body: solidPng(1000, 500, [224, 32, 32]), contentType: 'image/png' }),
    );
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Gallery' }).click();
    const floor = await colourAt(page, [25, 35]);
    await page.getByLabel('Underlay image URL').fill('/plan-image');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    // 20 × 10 m from (0, 36): its bottom-right corner (20, 26) lies inside the VIP lounge Zone.
    await expect.poll(() => colourAt(page, [10, 35])).not.toEqual(floor);
    await clickAt(page, [10, 35]);

    const corner = await pageAt(page, [20, 26]);
    await page.mouse.move(corner.x, corner.y);
    await expect(page.locator('.af-stage')).toHaveCSS('cursor', 'nwse-resize');
    await dragAt(page, [20, 26], [30, 21]);

    const underlay = (await documentOf(page)).levels.find((l) => l.id === 'gallery')!.underlays[0]!;
    expect(underlay.scale).toBeCloseTo(0.03, 3);
    expect(underlay.position).toEqual([0, 36]);
    // Drawn 30 × 15 m now: red at x 25, floor again past x 30.
    await expect.poll(() => colourAt(page, [25, 35])).not.toEqual(floor);
    expect(await colourAt(page, [32, 35])).toEqual(floor);
    // The lounge did not move.
    expect(
        (await documentOf(page)).levels.find((l) => l.id === 'gallery')!.zones[0]!.shape.outer,
    ).toEqual([
        [4, 24],
        [24, 24],
        [24, 34],
        [4, 34],
    ]);
});

test('a typed length places the next Wall corner; the Length field changes it later', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.getByRole('button', { name: 'Wall', exact: true }).click();

    await clickAt(page, [30, 22]);
    const toward = await pageAt(page, [40, 22]);
    await page.mouse.move(toward.x, toward.y);
    await page.keyboard.type('7.5');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const wall = async () => {
        const gallery = (await documentOf(page)).levels.find((l) => l.id === 'gallery')!;
        const at = (id: string) => gallery.wallNodes.find((n) => n.id === id)!.position;
        return gallery.walls.map((w) => [at(w.a), at(w.b)]);
    };
    expect(await wall()).toEqual([
        [
            [30, 22],
            [37.5, 22],
        ],
    ]);

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickAt(page, [34, 22]);
    const length = page.getByLabel('Wall length in metres');
    await expect(length).toHaveValue('7.5');
    await length.fill('5');
    await length.press('Enter');
    await expect.poll(wall).toEqual([
        [
            [30, 22],
            [35, 22],
        ],
    ]);
});

test('⌘C / ⌘V pastes a copy of a booth one grid step away, as one undo step', async ({ page }) => {
    await open(page, '&mode=edit');
    const before = await documentOf(page);
    const level = before.levels[0]!;
    const step = before.grid.step;

    await clickAt(page, [7.5, 7.5]);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');

    const zones = async () => (await documentOf(page)).levels[0]!.zones;
    await expect.poll(async () => (await zones()).length).toBe(level.zones.length + 1);
    // The topmost Zone under the click: the booth that got selected.
    const original = zoneAt(level, [7.5, 7.5])!;
    const copy = (await zones()).find((z) => !level.zones.some((o) => o.id === z.id))!;
    expect(copy.label).toBe(original.label);
    expect(copy.shape.outer).toEqual(original.shape.outer.map(([x, y]) => [x + step, y - step]));

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await zones()).length).toBe(level.zones.length);
});

test('calibrating with Straighten squares up a crooked Underlay', async ({ page }) => {
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.getByLabel('Underlay image URL').fill('/sample-underlay.svg');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const underlay = async () =>
        (await documentOf(page)).levels.find((l) => l.id === 'gallery')!.underlays[0]!;
    await expect.poll(async () => (await underlay())?.size).toEqual([1000, 500]);

    // A scan that came in 3° off.
    const rotation = page.getByLabel('Underlay rotation in degrees');
    await rotation.fill('3');
    await rotation.press('Enter');
    await expect.poll(async () => (await underlay()).rotation).toBeCloseTo((3 * Math.PI) / 180);

    // Mark a line across the middle of the image, 800 px long, that should be horizontal.
    await page.getByRole('button', { name: 'Calibrate' }).click();
    const crooked = await underlay();
    await clickAt(page, underlayToWorld(crooked, [100, 250]));
    await clickAt(page, underlayToWorld(crooked, [900, 250]));
    await page.getByLabel('Straighten: make the marked line horizontal or vertical').check();
    const distance = page.getByLabel('Real distance in metres');
    await distance.fill('16');
    await distance.press('Enter');

    await expect.poll(async () => (await underlay()).rotation).toBeCloseTo(0, 2);
    expect((await underlay()).scale).toBeCloseTo(0.02, 3);
});

test('in feet, typed Wall lengths and the Length field read and show feet', async ({ page }) => {
    await open(page, '&mode=edit');
    await page.getByLabel('Units').selectOption('imperial');
    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.getByRole('button', { name: 'Wall', exact: true }).click();

    await clickAt(page, [30, 22]);
    const toward = await pageAt(page, [40, 22]);
    await page.mouse.move(toward.x, toward.y);
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const length = async () => {
        const gallery = (await documentOf(page)).levels.find((l) => l.id === 'gallery')!;
        const [wall] = gallery.walls;
        const at = (id: string) => gallery.wallNodes.find((n) => n.id === id)!.position;
        const [a, b] = [at(wall!.a), at(wall!.b)];
        return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    expect(await length()).toBeCloseTo(3.048, 6); // 10 ft, stored in metres

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickAt(page, [31.5, 22]);
    const field = page.getByLabel('Wall length in feet');
    await expect(field).toHaveValue('10');
    await field.fill(`12' 6"`);
    await field.press('Enter');
    await expect.poll(length).toBeCloseTo(3.81, 6);
});

test('a booth copied in one Space pastes in place into another, through the system clipboard', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const booth = zoneAt((await documentOf(page)).levels[0]!, [7.5, 7.5])!;
    await clickAt(page, [7.5, 7.5]);
    await page.keyboard.press('ControlOrMeta+c');

    await fromMenu(page, 'File', 'New Space…');
    const form = page.getByRole('form', { name: 'Create space' });
    await form.getByLabel('Name').fill('Second hall');
    await form.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => documentOf(page).then((d) => d.name)).toBe('Second hall');

    await page.locator('.af-editor').focus();
    await page.keyboard.press('ControlOrMeta+v');

    const zones = async () => (await documentOf(page)).levels[0]!.zones;
    await expect.poll(async () => (await zones()).length).toBe(1);
    const [pasted] = await zones();
    expect(pasted!.label).toBe(booth.label);
    expect(pasted!.shape.outer).toEqual(booth.shape.outer); // another Document: in place
});

test('a door opens to the side it was placed from; F and the Properties panel turn it', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const door = (id: string) =>
        documentOf(page).then((d) => d.levels[0]!.openings.find((o) => o.id === id)!);

    await clickAt(page, [9, 28]);
    await page.keyboard.press('f');
    expect(await door('room-door')).toMatchObject({ swing: 'right' });
    await page.getByLabel('Hinge').selectOption('end');
    expect(await door('room-door')).toMatchObject({ swing: 'right', hinge: 'end' });

    // Placed from below the room's south wall, which is its right side (it runs west to east).
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await clickAt(page, [4, 27.96]);
    const placed = (await documentOf(page)).levels[0]!.openings.find(
        (o) => o.host === 'wall' && o.wallId === 'room-s' && o.id !== 'room-door',
    );
    expect(placed).toMatchObject({ kind: 'door', swing: 'right' });
});

test('dropping a Wall end onto another Wall joins them in a T, as one undo step', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const wallsAt = (x: number, y: number) =>
        documentOf(page).then((d) => {
            const level = d.levels[0]!;
            const node = level.wallNodes.find(
                (n) => Math.abs(n.position[0] - x) < 1e-6 && Math.abs(n.position[1] - y) < 1e-6,
            );
            return node ? level.walls.filter((w) => w.a === node.id || w.b === node.id).length : 0;
        });

    // A free-standing Wall north of the south exterior wall.
    await page.getByRole('button', { name: 'Wall', exact: true }).click();
    await clickAt(page, [20, 3]);
    await clickAt(page, [20, 8]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Select', exact: true }).click();

    await dragAt(page, [20, 3], [20, 0.1]);

    expect(await wallsAt(20, 0)).toBe(3);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await wallsAt(20, 0)).toBe(0);
    expect(await wallsAt(20, 3)).toBe(1);
});

test('the Levels list reads top-down; Move, drag and drop, and Alt+arrows reorder it', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const levelsSection = page.locator('.af-sidebar section', {
        has: page.getByRole('heading', { name: 'Levels' }),
    });
    // Under the heading, which is a button too (it folds the section).
    const buttons = levelsSection.locator('.af-section-body').getByRole('button');
    const list = levelsSection.getByRole('list', { name: 'Levels' });
    const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });

    // Highest first, with the add buttons above and below the list, and each Level's elevation.
    await expect(buttons).toHaveText([
        '+ Level',
        'Gallery',
        'Level 1',
        'Services',
        '+ Level below',
    ]);
    await expect(row('Gallery')).toContainText('6.00 m');

    // Move up re-sorts the list straight away.
    await page.getByRole('button', { name: 'Move up' }).click();
    await expect(buttons).toHaveText([
        '+ Level',
        'Level 1',
        'Gallery',
        'Services',
        '+ Level below',
    ]);
    await page.getByRole('button', { name: 'Undo' }).click();

    // Dragging a new basement onto the top half of the Gallery row puts it on top, as one undo step.
    await page.getByRole('button', { name: '+ Level below' }).click();
    await expect(buttons).toHaveText([
        '+ Level',
        'Gallery',
        'Level 1',
        'Services',
        'Basement 2',
        '+ Level below',
    ]);
    await row('Basement 2').dragTo(row('Gallery'), { targetPosition: { x: 10, y: 2 } });
    await expect(buttons).toHaveText([
        '+ Level',
        'Basement 2',
        'Gallery',
        'Level 1',
        'Services',
        '+ Level below',
    ]);
    // The current Level does not change by dragging.
    await expect(page.getByRole('button', { name: 'Level 1', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(buttons).toHaveText([
        '+ Level',
        'Gallery',
        'Level 1',
        'Services',
        'Basement 2',
        '+ Level below',
    ]);

    // Alt+↓ on a focused row moves that Level down.
    await page.getByRole('button', { name: 'Gallery', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(buttons).toHaveText([
        '+ Level',
        'Level 1',
        'Gallery',
        'Services',
        'Basement 2',
        '+ Level below',
    ]);
});

test("a Zone's text colour is set next to its fill, and can go back to the default", async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const booth = () =>
        documentOf(page).then((d) => d.levels[0]!.zones.find((z) => z.id === 'A-1')!);

    await clickAt(page, [7.5, 7.5]);
    await page.getByLabel('Text colour').fill('#ffffff');
    await expect.poll(() => booth().then((z) => z.labelColor)).toBe('#ffffff');

    await page.getByRole('button', { name: 'Default text colour' }).click();
    await expect.poll(() => booth().then((z) => z.labelColor)).toBeUndefined();
});

test('Fit in the plan corner brings the whole Level back into view', async ({ page }) => {
    await open(page, '&mode=edit');
    const fitted = await pageAt(page, [0, 0]);

    // Pan away with the middle button.
    await page.mouse.move(400, 400);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(150, 250, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    expect(await pageAt(page, [0, 0])).not.toEqual(fitted);

    await page.getByRole('button', { name: 'Fit', exact: true }).click();

    expect(await pageAt(page, [0, 0])).toEqual(fitted);
});

test('Zones take a suggested or a custom category, from the toolbar or the properties', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Zone', exact: true }).click();
    const toolbarCategory = page.getByLabel('Zone category');
    await expect(toolbarCategory).toHaveValue('booth'); // the exhibition Preset's default

    // A suggested category, typed by its label: stored by id, and Restricted as the Preset says.
    await toolbarCategory.fill('Aisle');
    await dragAt(page, [42, 4], [48, 8]);
    const lastZone = async () => (await documentOf(page)).levels[0]!.zones.at(-1)!;
    expect(await lastZone()).toMatchObject({ category: 'aisle', restricted: true });

    // A category of the user's own, in the properties of the selected Zone.
    const category = page.getByRole('combobox', { name: 'Category', exact: true });
    await expect(category).toHaveValue('aisle');
    await category.fill('Press area');
    await category.press('Enter');
    await expect.poll(async () => (await lastZone()).category).toBe('Press area');
});

test('Walk-around: from the category, per Zone, and for several Zones at once', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const zone = async (id: string) =>
        (await documentOf(page)).levels[0]!.zones.find((z) => z.id === id)!;

    // A new booth starts as Walk-around, as the exhibition Preset says.
    await page.getByRole('button', { name: 'Zone', exact: true }).click();
    await dragAt(page, [42, 4], [45, 7]);
    const drawn = (await documentOf(page)).levels[0]!.zones.at(-1)!;
    expect(drawn).toMatchObject({ category: 'booth', walkAround: true });

    // One Zone: the checkbox turns it off.
    const walkAround = page.getByRole('checkbox', { name: 'Visitors walk around it' });
    await expect(walkAround).toBeChecked();
    await walkAround.uncheck();
    await expect.poll(async () => (await zone(drawn.id)).walkAround).toBeUndefined();

    // Two booths, one of them changed: the shared checkbox is mixed, and one click sets both.
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickAt(page, [7.5, 7.5]);
    await walkAround.uncheck();
    await page.keyboard.down('Shift');
    await clickAt(page, [10.5, 7.5]);
    await page.keyboard.up('Shift');
    await expect(page.getByText('2 elements selected')).toBeVisible();
    await expect(walkAround).toHaveJSProperty('indeterminate', true);
    await walkAround.click();
    await expect
        .poll(async () => [(await zone('A-1')).walkAround, (await zone('A-2')).walkAround])
        .toEqual([true, true]);

    // One undo step brings the mixed state back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
        .poll(async () => [(await zone('A-1')).walkAround, (await zone('A-2')).walkAround])
        .toEqual([undefined, true]);
});

test('a selected Zone is resized by dragging its corner, or by typing its width', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.getByRole('button', { name: 'Zone', exact: true }).click();
    await dragAt(page, [42, 4], [48, 8]);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const outer = async () => {
        const zone = (await documentOf(page)).levels[0]!.zones.at(-1)!;
        return zone.shape.outer.map((p) => p.join(',')).sort();
    };

    // Dragging the top-right corner keeps the booth a rectangle; the opposite corner stays.
    await dragAt(page, [48, 8], [50, 10]);
    expect(await outer()).toEqual(['42,10', '42,4', '50,10', '50,4']);

    // Typing a width keeps the top-left corner.
    const width = page.getByLabel('Width in metres');
    await width.fill('5');
    await width.press('Enter');
    await expect.poll(outer).toEqual(['42,10', '42,4', '47,10', '47,4']);
});

test('? opens the keyboard shortcuts window; Esc closes it and the Wall goes on', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const walls = () => documentOf(page).then((d) => d.levels[0]!.walls.length);
    const before = await walls();
    await page.getByRole('button', { name: 'Wall', exact: true }).click();
    await clickAt(page, [40, 2]);
    await clickAt(page, [44, 2]);
    expect(await walls()).toBe(before + 1);

    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByRole('listitem').filter({ hasText: 'Duplicate the selection' }),
    ).toContainText('D');
    // Keys do nothing while it is open.
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Wall', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await clickAt(page, [44, 6]);
    expect(await walls()).toBe(before + 2);

    // The toolbar button opens it too, and a click beside it closes it.
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(dialog).toBeHidden();

    // The Playground owns the window (shortcutsOpen), and opens it from its own File menu;
    // closing it in the editor reports back, so the menu opens it again.
    await fromMenu(page, 'File', 'Keyboard shortcuts');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await fromMenu(page, 'File', 'Keyboard shortcuts');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Keys reach the editor again once it is closed.
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    // Not in View mode, where there is no editor.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

test('Problems: a room left without a door is listed, shown on a click, and gone after undo', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const problems = page.locator('.af-problems');
    const heading = page.getByRole('heading', { name: /^Problems/ });
    // The sample plan has none, so there is no Problems section.
    await page.waitForTimeout(1200);
    await expect(heading).toBeHidden();

    // The meeting room's only door, 1 m wide at x = 9 in its south Wall.
    await clickAt(page, [9, 28]);
    await page.keyboard.press('Delete');
    await expect(heading).toHaveText('Problems1');
    const problem = problems.getByRole('button', { name: /Visitors can't reach Meeting room/ });
    await expect(problem).toBeVisible();

    // A click selects the room: its label is in the properties.
    await clickAt(page, [40, 30]); // empty floor: nothing selected
    await problem.click();
    await expect(
        page.locator('.af-props dt', { hasText: /^Label$/ }).locator('+ dd input'),
    ).toHaveValue('Meeting room');

    // Undo brings the door back, and the Problem goes.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(heading).toBeHidden();
});

test('Here for visitors: a point picked in the Editor, and its link starts routes there', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const levelId = (await documentOf(page)).levels.find((l) => l.name === 'Level 1')!.id;

    // Pick a point: its value is the Level and the point, and nothing in the plan changes.
    await page.getByRole('button', { name: 'Pick a point…' }).click();
    await clickAt(page, [15, 3]);
    const dialog = page.getByRole('dialog', { name: 'Here for visitors' });
    await expect(dialog.getByRole('textbox', { name: 'Here' })).toHaveValue(`${levelId}:15,3`);
    const link = await dialog.getByRole('textbox', { name: 'Link' }).inputValue();
    expect(link).toContain(`?here=${encodeURIComponent(`${levelId}:15,3`)}`);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // A Zone's value is its id.
    await clickAt(page, [7.5, 7.5]);
    await expect(page.locator('.af-props').getByRole('textbox', { name: 'Here' })).toHaveValue(
        'A-1',
    );

    // The link opens the visitor view with "You are here" at that point. It names no plan, and
    // this one is not saved, so the Expo demo is asked for, as on the page it was picked on.
    await page.goto(`${link}&sample=expo&e2e=1`);
    await ready(page);
    const pin = page.locator('.af-pin-here');
    await expect(pin).toBeVisible();
    const box = (await pin.boundingBox())!;
    const at = await pageAt(page, [15, 3]);
    expect(Math.hypot(box.x + box.width / 2 - at.x, box.y + box.height / 2 - at.y)).toBeLessThan(3);
});
