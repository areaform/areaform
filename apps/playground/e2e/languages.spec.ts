import { createEditor, createSpace, type AreaformDocument } from '@areaform/core';
import { expect, type Page } from '@playwright/test';
import { clickAt, documentOf, fromMenu, open, test } from './helpers.ts';

const zoneOf = async (page: Page, id: string) =>
    (await documentOf(page)).levels.flatMap((l) => l.zones).find((z) => z.id === id)!;

/** The field under a caption in the properties panel, e.g. `Label (PL)`. */
const field = (page: Page, caption: string) =>
    page
        .locator('.af-props dt', { hasText: new RegExp(`^${caption.replace(/[()]/g, '\\$&')}$`) })
        .locator('+ dd input');

/** How many texts the language switch says are missing in `tag`. */
async function missingIn(page: Page, tag: string): Promise<number> {
    const option = page.getByLabel('Language you are filling in').locator(`option[value="${tag}"]`);
    const match = /(\d+) missing/.exec((await option.textContent()) ?? '');
    return match ? Number(match[1]) : 0;
}

test('filling in Polish shows what is missing, and a translation goes beside the label', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    const before = await missingIn(page, 'pl');
    expect(before).toBeGreaterThan(40); // the 40 booths have no Polish names

    await page.getByLabel('Language you are filling in').selectOption('pl');
    await page.getByRole('button', { name: /^Select\b/ }).click();
    await clickAt(page, [7.5, 7.5]); // booth A-1

    // Empty, with the English name to go by.
    const label = field(page, 'Label (PL)');
    await expect(label).toHaveValue('');
    await expect(label).toHaveAttribute('placeholder', 'A-1');
    // Names still to translate are faded on the plan; translated ones show in Polish.
    await page.waitForTimeout(500);
    await expect(page.locator('.af-editor')).toHaveScreenshot('editor-filling-pl.png');

    await label.fill('Stoisko A-1');
    await label.press('Enter');
    await expect
        .poll(() => zoneOf(page, 'A-1'))
        .toMatchObject({
            label: 'A-1',
            labels: { pl: 'Stoisko A-1' },
        });
    expect(await missingIn(page, 'pl')).toBe(before - 1);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => zoneOf(page, 'A-1').then((z) => z.labels)).toBeUndefined();
});

/** A plan made before Content Languages: no `languages`, one named Zone. */
function oldPlan(): AreaformDocument {
    const editor = createEditor(createSpace({ name: 'Halle', kind: 'exhibition', size: [20, 10] }));
    editor.exec({
        type: 'zone.add',
        levelId: editor.getDocument().levels[0]!.id,
        zone: {
            id: 'cafe',
            label: 'Café',
            shape: {
                outer: [
                    [2, 2],
                    [8, 2],
                    [8, 6],
                    [2, 6],
                ],
            },
        },
    });
    return editor.getDocument();
}

test('a plan with no language asks for one, then languages are added and removed', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.locator('input[type=file][multiple]').setInputFiles([
        {
            name: 'plan.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(oldPlan())),
        },
    ]);
    await expect.poll(() => documentOf(page).then((d) => d.name)).toBe('Halle');
    const languages = page.locator('.af-sidebar section', {
        has: page.getByRole('heading', { name: 'Languages' }),
    });

    // Not assumed English: the author says which language the names are in.
    await expect(languages).toContainText('not set yet');
    await languages.getByLabel("Language the plan's names are written in").selectOption('de');
    await languages.getByRole('button', { name: 'Set' }).click();
    await expect.poll(() => documentOf(page).then((d) => d.languages)).toEqual({ default: 'de' });

    const adding = languages.getByLabel('Language to add, e.g. pl, de or pt-BR');
    await adding.fill('english');
    await languages.getByRole('button', { name: 'Add language' }).click();
    await expect(languages).toContainText('Not a language tag');
    await adding.fill('en');
    await languages.getByRole('button', { name: 'Add language' }).click();
    await expect
        .poll(() => documentOf(page).then((d) => d.languages))
        .toEqual({
            default: 'de',
            others: ['en'],
        });

    await page.getByLabel('Language you are filling in').selectOption('en');
    await page.getByRole('button', { name: /^Select\b/ }).click();
    await clickAt(page, [5, 4]);
    await field(page, 'Label (EN)').fill('Coffee bar');
    await field(page, 'Label (EN)').press('Enter');
    await expect.poll(() => zoneOf(page, 'cafe')).toMatchObject({ labels: { en: 'Coffee bar' } });

    // Removing a language keeps its texts, hidden.
    await languages.getByRole('button', { name: 'Remove EN · English' }).click();
    await expect.poll(() => documentOf(page).then((d) => d.languages)).toEqual({ default: 'de' });
    expect((await zoneOf(page, 'cafe')).labels).toEqual({ en: 'Coffee bar' });
    await expect(page.getByLabel('Language you are filling in')).toHaveValue('de');
});

test('a new Space is written in the language picked in the wizard', async ({ page }) => {
    await open(page, '&mode=edit');
    await fromMenu(page, 'File', 'New Space…');
    const form = page.getByRole('form', { name: 'Create space' });
    // The interface language is preselected, as the suggested names are in it.
    await expect(form.getByLabel('Text language')).toHaveValue('en');
    await form.getByLabel('Text language').selectOption('pl');
    await form.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => documentOf(page).then((d) => d.languages)).toEqual({ default: 'pl' });
});
