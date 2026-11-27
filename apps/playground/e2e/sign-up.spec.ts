import { expect, type Page } from '@playwright/test';
import { fromMenu, loadDemo, open, ready, test } from './helpers.ts';

/**
 * Serves this playground at https://areaform.app/, where the hosted build offers to sign up; a copy
 * run anywhere else shows no card.
 */
async function openAsHosted(page: Page, baseURL: string, query = '') {
    await page.route('https://areaform.app/**', async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
        await route.fulfill({ response });
    });
    await page.goto(`https://areaform.app/?e2e=1&sample=expo${query}`);
    await ready(page);
}

const card = (page: Page) =>
    page.getByRole('complementary', { name: 'Put this plan on your site' });

test('a copy of the playground run elsewhere never offers to sign up', async ({ page }) => {
    await open(page);
    await loadDemo(page, 'Office');
    await expect(card(page)).toHaveCount(0);
});

test('on areaform.app the card comes once a plan changes, and stays closed', async ({
    page,
    baseURL,
}) => {
    await openAsHosted(page, baseURL!);
    await expect(card(page)).toHaveCount(0);

    await loadDemo(page, 'Office');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('link', { name: 'Sign up free' })).toHaveAttribute(
        'href',
        'https://app.areaform.app/sign-up',
    );

    await card(page).getByRole('button', { name: 'Close' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await ready(page);
    await loadDemo(page, 'Expo');
    await expect(card(page)).toHaveCount(0);
});

test('on areaform.app an export says where the plan goes next', async ({ page, baseURL }) => {
    await openAsHosted(page, baseURL!);
    const download = page.waitForEvent('download');
    await fromMenu(page, 'File', /^Export plan/);
    await download;
    await expect(page.getByRole('link', { name: 'sign up free' })).toHaveAttribute(
        'href',
        'https://app.areaform.app/sign-up',
    );
});
