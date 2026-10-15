import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Snapshot } from '../../src/orion/types';

const uid = '10000000-0000-0000-0000-000000000001';
function fixture(): Snapshot {
    const now = new Date().toISOString();
    return {
        profile: { id: uid, display_name: 'Ari', timezone: 'UTC', units: 'metric', onboarded: true, xp: 360, imported: false, domains: ['Strength', 'Intellect'], attributes: { Strength: 15, Endurance: 12, Vitality: 11, Intellect: 16, Discipline: 13, Connection: 10 } },
        activities: [{ id: 'a', kind: 'running', title: 'Morning run', minutes: 30, metres: 5000, notes: 'A calm start', attribute: 'Endurance', occurred_at: now, recorded_at: now, daily_key: null, base_xp: 30, base_points: 1 }],
        sets: [], exercises: [{ id: 'e', name: 'Incline dumbbell press', bodyweight: false, dumbbell: true }], habits: [{ id: 'h', name: 'Read before bed', archived: false }],
        definitions: [], quests: [{ id: 'q', definition_id: 'd', title: 'A chapter a day', attribute: 'Intellect', period: 'daily', target: 20, progress: 10, metric: 'minutes', starts_at: '2020-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', completed_at: null, archived: false }],
        bosses: [], templates: [{ id: 'first-gate', title: 'The first gate', hours: 24, attributes: ['Strength', 'Discipline'], objectives: [{ metric: 'workouts', target: 1 }, { metric: 'minutes', target: 60 }] }], events: [], server_time: now,
    };
}
async function mock(page: Page, state = fixture()) {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('http://127.0.0.1:54399/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('orion_snapshot')) await route.fulfill({ json: state });
        else if (path.endsWith('orion_command')) await route.fulfill({ json: { saved: true } });
        else if (path.endsWith('orion_export')) await route.fulfill({ json: state });
        else await route.fulfill({ json: {} });
    });
    await page.addInitScript(({ uid }) => {
        const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.signature';
        localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: 'ari@example.test', aud: 'authenticated', role: 'authenticated' } }));
    }, { uid });
}
test('all six screens fit mobile through desktop in both themes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mock(page); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'A little stronger.' })).toBeVisible();
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const tab of ['Dashboard', 'Quests', 'Training', 'Journal', 'Character', 'Settings']) {
                await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
                await expect(page.locator('main')).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            }
            if (width === 320 || width === 1440) {
                await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
                await page.screenshot({ path: `/tmp/orion-${theme}-${width}.png`, fullPage: true });
            }
        }
    }
    expect(errors).toEqual([]);
    await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.screenshot({ path: '/tmp/orion-dashboard.png', fullPage: true });
});
test('training draft survives navigation and saves canonical completed sets', async ({ page }) => {
    const state = fixture(); state.exercises.unshift({ id: 'other', name: 'Barbell squat', bodyweight: false, dumbbell: false });
    await mock(page, state); await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await page.getByLabel('Title (optional)').fill('Evening lift');
    await page.getByLabel('Search exercises').fill('incline');
    await page.getByRole('button', { name: 'Add set', exact: true }).click();
    await page.getByLabel('Reps', { exact: true }).fill('8'); await page.getByLabel('kg', { exact: true }).fill('22.5');
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await expect(page.getByLabel('Title (optional)')).toHaveValue('Evening lift');
    const request = page.waitForRequest(r => r.url().endsWith('orion_command'));
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    const body = (await request).postDataJSON();
    expect(body.payload.sets[0]).toEqual({ exercise_id: 'e', reps: 8, kg: 22.5 });
    expect(body.payload.title).toBe('Evening lift');
});
test('uncertain save retries the same command ID; rejected saves can be corrected', async ({ page }) => {
    await mock(page); let calls = 0; const ids: string[] = [];
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        ids.push(route.request().postDataJSON().command_id); calls++;
        if (calls === 1) await route.abort('failed');
        else await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    expect(ids[0]).toBe(ids[1]);
    await page.route('**/rest/v1/rpc/orion_command', route => route.fulfill({ status: 400, json: { code: 'P0001', message: 'Choose a valid timezone' } }));
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByRole('alert')).toContainText('Choose a valid timezone');
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
});
test('boss acceptance displays exact stakes and requires explicit confirmation', async ({ page }) => {
    await mock(page); await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Quests', exact: true }).click();
    await expect(page.getByText('Victory: +250 XP, +5 in each of Strength and Discipline.')).toBeVisible();
    await expect(page.getByText('Failure: −75 XP, −2 in each of Strength and Discipline.')).toBeVisible();
    await page.getByRole('button', { name: 'Review acceptance' }).click();
    await expect(page.getByRole('button', { name: 'Accept mission and penalties' })).toBeVisible();
});
test('onboarding, empty history, keyboard navigation, reduced motion', async ({ page }) => {
    const state = fixture(); state.profile.onboarded = false;
    await mock(page, state); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to Orion' })).toBeVisible();
    await page.getByLabel('Display name').fill('New player');
    await page.getByLabel('Timezone').fill('UTC');
    await page.getByLabel('Strength', { exact: true }).focus(); await page.keyboard.press('Space');
    await expect(page.getByLabel('Strength', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Enter the System' }).focus();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Enter the System');
    state.profile.onboarded = true; state.activities = []; state.quests = []; await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await expect(page.getByText('Your first session is a starting point. Log it above.')).toBeVisible();
});
test('active boss and long player content fit the smallest viewport', async ({ page }) => {
    const state = fixture();
    state.profile.display_name = 'A'.repeat(60);
    state.quests[0]!.title = 'Q'.repeat(120);
    state.habits[0]!.name = 'H'.repeat(100);
    state.bosses = [{ ...state.templates[0]!, id: 'boss', template_id: 'first-gate', accepted_at: new Date(Date.now() - 1000).toISOString(), deadline: new Date(Date.now() + 1000 * 86400).toISOString(), resolved_at: null, status: 'active' }];
    await mock(page, state); await page.setViewportSize({ width: 320, height: 900 }); await page.goto('/');
    for (const tab of ['Dashboard', 'Quests', 'Training', 'Journal', 'Character', 'Settings']) {
        await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab).toBe(true);
    }
});
test('email signup, sign-in, sign-out, and reset requests are wired to Auth', async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('http://127.0.0.1:54399/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('orion_snapshot')) return route.fulfill({ json: fixture() });
        if (path.endsWith('/token')) {
            const access = btoa('{"alg":"HS256"}') + '.' + btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.sig';
            return route.fulfill({ json: { access_token: access, refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: uid, email: 'ari@example.test', aud: 'authenticated', role: 'authenticated' } } });
        }
        return route.fulfill({ json: path.endsWith('/signup') ? { id: uid, email: 'ari@example.test' } : {} });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('ari@example.test');
    await page.getByLabel('Password', { exact: true }).fill('example-password');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Check your email');
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A little stronger.' })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back, player' })).toBeVisible();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email', { exact: true }).fill('ari@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('password reset link');
});

test('sound opt-in previews audio and confirmed rewards play once', async ({ page }) => {
    const state = fixture();
    await mock(page, state);
    await page.addInitScript(() => {
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            document.documentElement.dataset.soundNotes = String(Number(document.documentElement.dataset.soundNotes ?? 0) + 1);
            return original.call(this);
        };
    });
    let sequence = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'activity') {
            sequence++;
            state.events.push({ id: String(sequence), source: 'activity:' + body.command_id, xp: 10, attributes: {}, created_at: new Date().toISOString() });
            state.profile.xp += 10;
        }
        await route.fulfill({ json: { saved: true } });
    });
    const notes = () => page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0));
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeEnabled();
    expect(await notes()).toBe(0);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Test sound', exact: true })).toBeDisabled();
    await page.getByLabel('Play reward sounds').check();
    expect(await notes()).toBe(3);
    await page.getByRole('button', { name: 'Test sound', exact: true }).click();
    expect(await notes()).toBe(6);
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect.poll(notes).toBe(9);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await notes()).toBe(9);
    await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Play reward sounds')).toBeChecked();
    expect(await notes()).toBe(0);
    await page.getByRole('button', { name: 'Test sound', exact: true }).click();
    expect(await notes()).toBe(3);
    await page.getByLabel('Play reward sounds').uncheck();
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeEnabled();
    expect(await notes()).toBe(3);
});

test('activity, habit, both quests, boss and level-up all play sequentially; mute cancels the queue', async ({ page }) => {
    const state = fixture();
    await mock(page, state);
    await page.addInitScript(() => {
        localStorage.setItem('orion-sound', 'on');
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            document.documentElement.dataset.soundNotes = String(Number(document.documentElement.dataset.soundNotes ?? 0) + 1);
            return original.call(this);
        };
    });
    let batch = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        batch++;
        state.events.push(...['activity:1', 'habit:1', 'quest:1', 'quest:2', 'boss:1'].map((source, i) => ({ id: `${batch}:${i}`, source, xp: 10, attributes: {}, created_at: new Date().toISOString() })));
        state.profile.xp = 675;
        await route.fulfill({ json: { saved: true } });
    });
    const notes = () => page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0));
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect.poll(notes, { timeout: 1000 }).toBe(3);
    await expect.poll(notes, { timeout: 8000 }).toBe(34);
    // Clear the first queue, then freeze timers to test muting deterministically.
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Play reward sounds').uncheck();
    await page.getByLabel('Play reward sounds').check();
    expect(await notes()).toBe(37);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect.poll(notes).toBe(40);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Play reward sounds').uncheck();
    await page.clock.fastForward(10000);
    expect(await notes()).toBe(40);
});
