import { expect, type Page } from '@playwright/test';
import { clickAt, documentOf, open, test } from './helpers.ts';

/** Every label, tooltip and visible text of the editor's own interface, outside the plan's content. */
function interfaceTexts(page: Page) {
    return page.evaluate(() => {
        const texts = new Set<string>();
        const roots = document.querySelectorAll(
            '.af-toolbar, .af-plan-controls, .af-sidebar h2, .af-sidebar dt, .af-sidebar button, .af-shortcuts',
        );
        for (const root of roots) {
            for (const el of [root, ...root.querySelectorAll('*')]) {
                for (const name of ['aria-label', 'title', 'placeholder'])
                    if (el.getAttribute(name)) texts.add(el.getAttribute(name)!);
                for (const node of el.childNodes)
                    if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim())
                        texts.add(node.textContent!.trim());
            }
        }
        return [...texts];
    });
}

/** Opens the editor with a booth selected and the shortcuts window open. */
async function showEverything(page: Page) {
    await page.getByRole('button', { name: /^(Select|Zaznaczanie)\b/ }).click();
    await clickAt(page, [7.5, 7.5]);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
}

test('the editor speaks Polish, with nothing left in English', async ({ page }) => {
    await open(page, '&mode=edit');
    await showEverything(page);
    const english = await interfaceTexts(page);
    await page.keyboard.press('Escape');

    await page.getByLabel('Interface language').selectOption('pl');
    await showEverything(page);
    await expect(page.getByRole('dialog', { name: 'Skróty klawiszowe' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Właściwości' })).toBeVisible();
    await expect(page.getByLabel('Szerokość w metrach')).toBeVisible();
    await expect(page.locator('.af-sidebar')).toContainText('Powierzchnia');

    // Texts the same in both languages: key names, symbols, 2D / 3D and numbers, and the plan's
    // own Level names, which are content.
    const levelNames = (await documentOf(page)).levels.map((l) => l.name);
    const same = (await interfaceTexts(page)).filter(
        (t) => english.includes(t) && !levelNames.includes(t),
    );
    const allowed =
        /^([A-Z0-9]|Esc|Ctrl|Shift|Alt|Enter|Delete|Backspace|0–9|2D|3D|m|ft|\?|[⌘⌥⇧×]+|[\d.,\s+−-]+|WC)$/;
    expect(same.filter((t) => !allowed.test(t))).toEqual([]);
});

test('the interface language is remembered and reaches the View', async ({ page }) => {
    await open(page);
    await page.getByLabel('Interface language').selectOption('ru');
    await expect(page.getByRole('button', { name: 'Вписать' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Interface language')).toHaveValue('ru');
    await expect(page.getByRole('button', { name: 'Показать сетку' })).toBeVisible();
});

test('number fields follow the interface language, whatever the browser speaks', async ({
    page,
}) => {
    await open(page, '&mode=edit');
    await page.getByLabel('Interface language').selectOption('pl');
    const thickness = page.getByLabel('Grubość ściany w metrach');
    await expect(thickness).toHaveValue('0,3');

    await page.getByRole('button', { name: /^Zaznaczanie\b/ }).click();
    await clickAt(page, [7.5, 7.5]);
    const width = page.getByLabel('Szerokość w metrach');
    await width.fill('2,5');
    await width.press('Enter');
    await expect(width).toHaveValue('2,5');
});
