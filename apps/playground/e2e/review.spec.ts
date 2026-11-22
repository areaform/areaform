import { createSpace, type AreaformDocument } from '@areaform/core';
import { expect } from '@playwright/test';
import { documentOf, loadDemo, open, openAsSaved, test } from './helpers.ts';

/** A one-pixel red PNG, stretched over the Hall as its Source. */
const SOURCE_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
);

/** A Draft as the MCP import writes it: a booth, the Source Underlay and two Import Flags. */
function draft(): AreaformDocument {
    const doc = createSpace({ name: 'Hall A', kind: 'exhibition', size: [30, 20] });
    const level = doc.levels[0]!;
    return {
        ...doc,
        meta: {
            import: {
                importedAt: '2026-10-22T12:00:00.000Z',
                scale: 0.1,
                flags: [
                    {
                        ref: { kind: 'zone', id: 'B1', levelId: level.id },
                        reason: "Unknown category 'lounge'",
                    },
                    { ref: { kind: 'level', id: level.id }, reason: 'Outline guessed' },
                ],
            },
        },
        levels: [
            {
                ...level,
                zones: [
                    {
                        id: 'B1',
                        label: 'Lounge',
                        shape: {
                            outer: [
                                [2, 2],
                                [8, 2],
                                [8, 6],
                                [2, 6],
                            ],
                        },
                    },
                ],
                underlays: [
                    {
                        id: 'import-source',
                        src: 'source.png',
                        position: [0, 20],
                        scale: 20,
                        rotation: 0,
                        opacity: 0.5,
                        locked: true,
                        size: [1, 1],
                    },
                ],
            },
        ],
    };
}

const planFile = (doc: AreaformDocument) => ({
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
});

test('a Draft imported with its Source image is reviewed flag by flag', async ({ page }) => {
    await open(page, '&mode=edit');
    await page
        .locator('input[type=file][multiple]')
        .setInputFiles([
            planFile(draft()),
            { name: 'source.png', mimeType: 'image/png', buffer: SOURCE_PNG },
        ]);
    await expect(page.getByRole('status')).toHaveText('Imported.');

    const review = page.getByRole('complementary', { name: 'Review import' });
    await expect(review.getByRole('heading')).toHaveText('Review import (2)');
    await expect(review).toContainText("Unknown category 'lounge'");

    // Show selects the flagged Zone in the editor.
    await review.getByRole('button', { name: 'Zone Lounge' }).click();
    await expect
        .poll(() => page.evaluate(() => globalThis.__fp!.events()))
        .toContain('selection:1');

    // Done takes the flag off the list as an undoable edit; the Underlay keeps its relative src.
    await review.getByRole('button', { name: 'Done' }).first().click();
    await expect(review.getByRole('heading')).toHaveText('Review import (1)');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(review.getByRole('heading')).toHaveText('Review import (2)');

    await review.getByRole('button', { name: 'Done' }).first().click();
    await review.getByRole('button', { name: 'Done' }).first().click();
    await expect(review).toHaveCount(0);
    const doc = await documentOf(page);
    expect(doc.levels[0]!.underlays[0]!.src).toBe('source.png');
    expect(doc.meta).toMatchObject({ import: { flags: [] } });
});

test('a flag shown once is not shown again when the editor comes back', async ({ page }) => {
    await open(page, '&mode=edit');
    await page
        .locator('input[type=file][multiple]')
        .setInputFiles([
            planFile(draft()),
            { name: 'source.png', mimeType: 'image/png', buffer: SOURCE_PNG },
        ]);
    const review = page.getByRole('complementary', { name: 'Review import' });
    // The Level's properties show while nothing is selected.
    const nothingSelected = page.getByLabel('Level name');
    await review.getByRole('button', { name: 'Zone Lounge' }).click();
    await expect(nothingSelected).toHaveCount(0);

    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(nothingSelected).toBeVisible();
    // Give a stale selection the time to be applied again.
    await page.waitForTimeout(500);
    await expect(nothingSelected).toBeVisible();
});

test('a plan imported without the image it names says so', async ({ page }) => {
    await open(page, '&mode=edit');
    await page.locator('input[type=file][multiple]').setInputFiles([planFile(draft())]);
    await expect(page.getByRole('status')).toContainText('source.png not found next to the plan');
});

test('with autosave on, a Draft keeps its Source image across a reload', async ({ page }) => {
    await openAsSaved(page, '&mode=edit');
    await page.getByLabel('Autosave').check();
    await page
        .locator('input[type=file][multiple]')
        .setInputFiles([
            planFile(draft()),
            { name: 'source.png', mimeType: 'image/png', buffer: SOURCE_PNG },
        ]);
    await expect(page.getByText('All changes saved')).toBeVisible();
    expect(await page.evaluate(() => globalThis.__fp!.assets())).toEqual(['source.png']);

    await page.reload();
    await page.waitForFunction(() => globalThis.__fp !== undefined);
    await expect.poll(() => page.evaluate(() => globalThis.__fp!.assets())).toEqual(['source.png']);
    expect((await documentOf(page)).levels[0]!.underlays[0]!.src).toBe('source.png');

    // Another plan shows no stale image.
    await loadDemo(page, 'Expo');
    await expect.poll(() => page.evaluate(() => globalThis.__fp!.assets())).toEqual([]);
});
