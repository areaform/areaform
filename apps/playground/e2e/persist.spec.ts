import type { Vec2 } from '@areaform/core';
import { test as base, expect, type Page } from '@playwright/test';
import {
    colourAt,
    documentOf,
    dragAt,
    loadDemo,
    open,
    openAsSaved,
    ready,
    solidPng,
    test,
} from './helpers.ts';

/** Booth A-1's lower-left corner in the live Document. */
const boothCorner = (page: Page) =>
    documentOf(page).then((d) => d.levels[0]!.zones.find((z) => z.id === 'A-1')!.shape.outer[0]!);

/**
 * Drags booth A-1 (3 × 3 m, at x 6–9) three metres left from wherever it is, into the free floor
 * west of the booths (the expo grid is 1 m).
 */
const moveBooth = async (page: Page) => {
    const [x, y] = await boothCorner(page);
    await dragAt(page, [x + 1.5, y + 1.5], [x - 1.6, y + 1.5]);
};

/** The Expo demo in the editor, without `?sample=`, so that a reload opens what was saved. */
const openExpo = async (page: Page) => {
    await openAsSaved(page, '&mode=edit');
    await loadDemo(page, 'Expo');
    await expect.poll(() => documentOf(page).then((d) => d.name)).toBe('Expo Hall A');
};

const reload = async (page: Page) => {
    await page.reload();
    await ready(page);
};

test('the playground opens with the Office demo when nothing is saved', async ({ page }) => {
    await openAsSaved(page);
    expect((await documentOf(page)).name).toBe('Areaform Office');
    await expect(page.getByRole('button', { name: 'Demos', exact: true })).toBeVisible();
});

// Playwright's own test: a new visitor, without the sections the other tests open.
base(
    'a new visitor sees only Properties open; a section opened or folded stays so after a reload',
    async ({ page }) => {
        await openExpo(page);
        const section = (name: string) => {
            const toggle = page.getByRole('button', { name, exact: true });
            return {
                toggle,
                body: page.locator('.af-section', { has: toggle }).locator('.af-section-body'),
            };
        };
        const properties = section('Properties');
        await expect(properties.body).toBeVisible();
        for (const name of ['Levels', 'Viewpoints', 'Languages', 'Where is it?']) {
            await expect(section(name).toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(section(name).body).toBeHidden();
        }

        const languages = section('Languages');
        await languages.toggle.click();
        await properties.toggle.click();
        await expect(languages.body).toBeVisible();
        await expect(properties.body).toBeHidden();

        await reload(page);
        await expect(languages.body).toBeVisible();
        await expect(properties.toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(properties.body).toBeHidden();
    },
);

test('with autosave on, an edit survives a reload', async ({ page }) => {
    await openExpo(page);
    const before = await boothCorner(page);

    await page.getByLabel('Autosave').check();
    await moveBooth(page);
    const moved: Vec2 = [before[0] - 3, before[1]];
    await expect.poll(() => boothCorner(page)).toEqual(moved);
    await expect(page.getByText('All changes saved')).toBeVisible();

    await reload(page);
    expect(await boothCorner(page)).toEqual(moved);
    await expect(page.getByLabel('Autosave')).toBeChecked();

    // A change still waiting for autosave is written when the page goes, without a prompt.
    await moveBooth(page);
    await reload(page);
    expect(await boothCorner(page)).toEqual([moved[0] - 3, moved[1]]);
});

test('with autosave off, only Save keeps an edit; Revert and closing warn first', async ({
    page,
}) => {
    await openExpo(page);
    const before = await boothCorner(page);
    await expect(page.getByLabel('Autosave')).not.toBeChecked();

    await moveBooth(page);
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
    const saved: Vec2 = [before[0] - 3, before[1]];

    // Another move, thrown away with Revert to saved (which asks first).
    await moveBooth(page);
    await page.getByRole('button', { name: 'Revert to saved' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).click();
    await expect.poll(() => boothCorner(page)).toEqual(saved);

    // And one more, left unsaved: reloading asks the browser's "Leave site?" first.
    await moveBooth(page);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
        dialogs.push(dialog.type());
        void dialog.accept();
    });
    await reload(page);
    expect(dialogs).toEqual(['beforeunload']);
    expect(await boothCorner(page)).toEqual(saved);
});

test('View mode shows the plan being edited', async ({ page }) => {
    await open(page, '&mode=edit');
    const before = await boothCorner(page);
    await moveBooth(page);

    await page.getByRole('button', { name: 'View', exact: true }).click();
    await ready(page);

    expect(await boothCorner(page)).toEqual([before[0] - 3, before[1]]);
});

test('loading a demo asks first when there are unsaved changes, then replaces the plan', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await moveBooth(page);

    await loadDemo(page, 'Stress');
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Replace the current plan');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect((await documentOf(page)).levels[0]!.zones.length).toBeLessThan(100);

    await loadDemo(page, 'Stress');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click();
    // 5,000 Zones: slow on a busy CI runner.
    await expect
        .poll(() => documentOf(page).then((d) => d.levels[0]!.zones.length), { timeout: 20_000 })
        .toBeGreaterThan(1000);

    // Nothing changed since the stress demo was loaded, so the expo demo replaces it at once.
    await loadDemo(page, 'Expo');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect
        .poll(() => documentOf(page).then((d) => d.levels[0]!.zones.length))
        .toBeLessThan(100);
});

test('units, Dimensions, the grid and the mode are remembered', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Units').selectOption('imperial');
    await page.getByRole('button', { name: 'Dimensions' }).click();
    await page.getByRole('button', { name: 'Show grid' }).click();

    await reload(page);

    await expect(page.getByRole('button', { name: 'Show grid' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );

    await expect(page.getByLabel('Units')).toHaveValue('imperial');
    await expect(page.getByRole('button', { name: 'Dimensions' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
});

test('an image kept on this device shows after a reload, and says where it is on another device', async ({
    page,
    browser,
}) => {
    await openExpo(page);
    await page.getByLabel('Autosave').check();
    await page.getByRole('button', { name: 'Gallery' }).click();
    // y 34–36 is clear of the VIP lounge; the Underlay covers x 0–20, y 26–36.
    const floor = await colourAt(page, [10, 35]);
    await page.getByLabel('Keep on this device…').setInputFiles({
        name: 'scan.png',
        mimeType: 'image/png',
        buffer: solidPng(1000, 500, [224, 32, 32]),
    });
    await expect(page.getByText(/^local:/)).toBeVisible();
    await expect.poll(() => colourAt(page, [10, 35])).not.toEqual(floor);
    await expect(page.getByText('All changes saved')).toBeVisible();

    await reload(page);
    await page.getByRole('button', { name: 'Gallery' }).click();
    await expect.poll(() => colourAt(page, [10, 35])).not.toEqual(floor);
    await expect(page.getByRole('note')).toHaveCount(0);

    // Another device: the same saved plan, without the browser's kept images.
    const other = await browser.newPage({ storageState: await page.context().storageState() });
    await openAsSaved(other, '&mode=edit');
    await other.getByRole('button', { name: 'Gallery' }).click();
    await expect(other.getByRole('note')).toHaveText(
        'This image is kept on another device. Add it again here to see it.',
    );
    expect(await colourAt(other, [10, 35])).toEqual(floor);
    await other.close();
});
