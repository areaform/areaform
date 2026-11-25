import { expect, test, type Page } from '@playwright/test';

/** The free spaces of each Level, as the panel lists them, top floor first. */
async function freeCounts(page: Page) {
    const rows = await page.locator('.level').allInnerTexts();
    return rows.map((text) => text.replace(/\s+/g, ' ').trim());
}

test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.plan canvas')).toBeVisible();
    // The feed's first report of every sensor fills in the counts.
    await expect(page.locator('.level')).toHaveCount(3);
    expect(errors).toEqual([]);
});

test('lists the free spaces of every Level from the sensor feed', async ({ page }) => {
    const counts = await freeCounts(page);
    expect(counts.map((c) => c.split(' ')[0])).toEqual(['P2', 'P1', 'P0']);
    for (const count of counts) expect(count).toMatch(/^P\d \d+ free of 40$/);
    // Some spots are taken: not every Level is all free.
    expect(counts.some((c) => !c.includes('40 free'))).toBe(true);
});

test('finds a free spot and shows the trip from the gate', async ({ page }) => {
    await page.getByRole('button', { name: 'Find a free spot' }).click();
    await expect(page.locator('#suggestion')).toHaveText(
        /Park at [A-D]\d\d on P\d: about \d+ min from the gate to the lift\./,
    );
    const steps = page.locator('#steps button');
    await expect(steps.first()).toHaveText(/^From the gate, drive /);
    await expect(steps.last()).toHaveText(/^Walk \d+ m to the lift$/);
    // Shown from its start: the gate, on P0, with the drive drawn from it.
    await expect(page.locator('.level', { hasText: 'P0' })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.trip__drive')).toHaveAttribute('d', /^M[\d.]+,[\d.]+L/);
    // The last step shows the spot's Level, with the walk to the lift.
    await steps.last().click();
    await expect(steps.last()).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.trip__walk')).toHaveAttribute('d', /^M[\d.]+,[\d.]+L/);
});

test('offers the next spot when the one it chose is taken, and leads to it', async ({ page }) => {
    // A clock of our own, so the simulated feed runs minutes in a moment and the same way each time.
    await page.clock.install();
    await page.goto('/');
    await page.clock.runFor(3000);
    await page.getByRole('button', { name: 'Find a free spot' }).click();
    await page.locator('.level', { hasText: 'P1' }).click();
    const before = await page.locator('#suggestion').innerText();
    for (let i = 0; i < 200; i++) {
        await page.clock.runFor(1500);
        if ((await page.locator('#suggestion').innerText()) !== before) break;
    }
    // Labels repeat on every Level, so the message names the Level of the spot taken.
    await expect(page.locator('#suggestion')).toHaveText(
        /^[A-D]\d\d on P\d was just taken\. Park at [A-D]\d\d on P\d: /,
    );
    // It stays on the Level the driver was looking at, and the steps now lead to the new spot.
    await expect(page.locator('.level', { hasText: 'P1' })).toHaveAttribute('aria-current', 'true');
    const next = /Park at ([A-D]\d\d) on/.exec(await page.locator('#suggestion').innerText())![1]!;
    await expect(page.locator('#steps button').nth(-2)).toHaveText(new RegExp(`to ${next}$`));
});

test('sends a car that needs a charger to a charging spot', async ({ page }) => {
    await page.getByLabel('EV charging').check();
    await page.getByRole('button', { name: 'Find a free spot' }).click();
    // Charging spots are A07 to A10, on P0 and P1.
    await expect(page.locator('#suggestion')).toHaveText(/^Park at A(07|08|09|10) /);
});

test('shows another Level when its row is pressed', async ({ page }) => {
    await page.locator('.level', { hasText: 'P2' }).click();
    await expect(page.locator('.level', { hasText: 'P2' })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.level', { hasText: 'P0' })).toHaveAttribute(
        'aria-current',
        'false',
    );
});
