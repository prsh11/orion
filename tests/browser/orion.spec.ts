import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { threshold } from '../../src/orion/logic';
import type { Snapshot } from '../../src/orion/types';

const uid = '10000000-0000-0000-0000-000000000001';
function fixture(): Snapshot {
    const now = new Date().toISOString();
    return {
        profile: { id: uid, display_name: 'Ari', timezone: 'UTC', units: 'metric', onboarded: true, xp: 360, imported: false, domains: ['Strength', 'Intellect'], attributes: { Strength: 15, Endurance: 12, Vitality: 11, Intellect: 16, Discipline: 13, Connection: 10 } },
        activities: [{ id: 'a', kind: 'running', title: 'Morning run', minutes: 30, metres: 5000, notes: 'A calm start', attribute: 'Endurance', occurred_at: now, recorded_at: now, daily_key: null, base_xp: 30, base_points: 1 }],
        sets: [], exercises: [{ id: 'e', name: 'Incline dumbbell press', bodyweight: false, dumbbell: true }], habits: [{ id: 'h', name: 'Read before bed', archived: false }],
        definitions: [], quests: [{ id: 'q', definition_id: 'd', kind: 'quest', planned_on: null, completion_revision: 0, applied_xp: 0, applied_points: 0, completion_history: [], difficulty: 'medium', due_at: null, reward_xp: 25, reward_points: 1, penalty_xp: 0, penalty_points: 0, title: 'A chapter a day', attribute: 'Intellect', period: 'daily', target: 20, progress: 10, metric: 'minutes', starts_at: '2020-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', completed_at: null, archived: false }],
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
                const artwork = page.locator('.rpg-art img');
                await expect(artwork).toHaveCount(1);
                await artwork.scrollIntoViewIfNeeded();
                await expect.poll(() => artwork.evaluate(img => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/orion-rpg-${theme}-${tab.toLowerCase()}-${width}.png`, fullPage: true });
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

async function audioState(page: Page) {
    return page.evaluate(async () => {
        const path = '/src/audio.ts';
        const module = await import(path);
        const audio = module.default as { isPlaying: () => boolean; settings: () => { enabled: boolean; volume: number } };
        return { playing: audio.isPlaying(), ...audio.settings() };
    });
}
async function countAudio(page: Page) {
    await page.addInitScript(() => {
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            document.documentElement.dataset.soundNotes = String(Number(document.documentElement.dataset.soundNotes ?? 0) + 1);
            return original.call(this);
        };
    });
}
test('sound opt-in, preview, volume, mute and confirmed reward playback persist correctly', async ({ page }) => {
    const state = fixture(); await mock(page, state); await countAudio(page);
    let sequence = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        sequence++; state.events.push({ id: String(sequence), source: 'activity:' + sequence, xp: 10, attributes: {}, created_at: new Date().toISOString() });
        state.profile.xp += 10; await route.fulfill({ json: { saved: true } });
    });
    const notes = () => page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0));
    await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dismiss reward' })).toBeVisible(); expect(await notes()).toBe(0);
    await page.getByRole('button', { name: 'Dismiss reward' }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Test sound', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Effects volume')).toHaveValue('40');
    await page.getByLabel('Play reward sounds').check(); await expect.poll(notes).toBeGreaterThan(0);
    let previous = await notes(); await page.getByRole('button', { name: 'Test sound', exact: true }).click(); await expect.poll(notes).toBeGreaterThan(previous);
    await page.getByLabel('Effects volume').fill('25'); expect((await audioState(page)).volume).toBe(.25);
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    previous = await notes(); await page.getByRole('button', { name: 'Save activity', exact: true }).click(); await expect.poll(notes).toBeGreaterThan(previous);
    await expect(page.locator('.reward-popup')).toContainText('+10 XP confirmed');
    await expect.poll(async () => (await audioState(page)).playing).toBe(false);
    const confirmedNotes = await notes(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeEnabled(); expect(await notes()).toBe(confirmedNotes);
    await page.reload(); expect(await notes()).toBe(0); await expect(page.locator('.reward-popup')).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Play reward sounds')).toBeChecked(); await expect(page.getByLabel('Effects volume')).toHaveValue('25');
    await page.getByLabel('Play reward sounds').uncheck();
    const mutedNotes = await notes(); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click(); await expect(page.locator('.reward-popup')).toBeVisible(); expect(await notes()).toBe(mutedNotes);
});

test('simultaneous milestones share a focused dialog; mute cancels voices and Continue restores focus', async ({ page }) => {
    const state = fixture(); await mock(page, state); await countAudio(page);
    await page.addInitScript(() => localStorage.setItem('orion-sound', 'on'));
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON();
        state.events.push(...[`activity:${body.command_id}`, 'habit:1', 'quest:1', 'quest:2', 'boss:1'].map((source, i) => ({ id: String(i), source, xp: 10, attributes: {}, created_at: new Date().toISOString() })));
        state.profile.xp = 675; await route.fulfill({ json: { saved: true, personal_record: true } });
    });
    await page.clock.install(); await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save activity', exact: true }); await save.focus(); await save.click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await expect(dialog).toContainText('Level 4 reached');
    await expect(dialog).toContainText('New personal record'); await expect(dialog.locator('.milestone-list li')).toHaveCount(7);
    await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.querySelector('dialog')?.contains(document.activeElement)))).toBe(true);
    await expect.poll(async () => (await audioState(page)).playing).toBe(true);
    await dialog.getByRole('button', { name: 'Mute sounds' }).click();
    expect((await audioState(page)).playing).toBe(false);
    const mutedNotes = await page.evaluate(() => document.documentElement.dataset.soundNotes);
    await page.clock.fastForward(10000); expect(await page.evaluate(() => document.documentElement.dataset.soundNotes)).toBe(mutedNotes);
    await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(save).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(dialog).toHaveCount(0);
});

test('daily todos quick add, optional terms, carry-forward, completion and undo in both themes', async ({ page }) => {
    const state = fixture(); const today = state.server_time.slice(0, 10);
    const todo = { ...state.quests[0]!, kind: 'todo' as const, period: 'one-off' as const, metric: 'manual' as const, target: 1, progress: 0, ends_at: null, planned_on: today };
    state.quests.push({ ...todo, id: 'late', title: 'Get groceries', attribute: 'Discipline', due_at: '2020-01-01T12:00:00Z' });
    state.quests.push({ ...todo, id: 'carry', title: 'Call the dentist', attribute: null, due_at: null, planned_on: '2020-01-01' });
    state.quests.push({ ...todo, id: 'future', title: 'Renew passport', due_at: null, planned_on: '2099-01-01' });
    await mock(page, state);
    await page.addInitScript(() => {
        localStorage.setItem('orion-sound', 'on');
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            document.documentElement.dataset.soundNotes = String(Number(document.documentElement.dataset.soundNotes ?? 0) + 1);
            return original.call(this);
        };
    });
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { action, payload } = route.request().postDataJSON(); submitted = payload;
        if (action === 'todo') state.quests.push({ ...todo, id: 'new', title: payload.title, attribute: payload.attribute ?? null });
        if (action === 'edit_todo') state.quests.find(q => q.id === payload.id)!.title = payload.title;
        if (action === 'set_todo_completed') {
            const q = state.quests.find(q => q.id === payload.id)!;
            if (payload.completed) {
                q.completed_at = state.server_time; q.applied_xp = 18; q.applied_points = -1; q.penalty_xp = 7; q.penalty_points = 1;
                q.completion_history = [{ revision: 1, difficulty: q.difficulty, due_at: q.due_at, planned_on: q.planned_on, completed_at: state.server_time, undone_at: null, reward_xp: 25, reward_points: 0, penalty_xp: 7, penalty_points: 1, attribute: 'Discipline', applied_xp: 18, applied_points: -1 }];
            } else { q.completed_at = null; q.completion_history[0]!.undone_at = state.server_time; }
            state.profile.xp += payload.completed ? 18 : -18;
            state.profile.attributes.Discipline += payload.completed ? -1 : 1;
            state.events.push({ id: payload.completed ? 'todo-complete' : 'todo-undo', source: payload.completed ? 'todo:late:1' : 'todo-undo:late:2', xp: payload.completed ? 18 : -18, attributes: { Discipline: payload.completed ? -1 : 1 }, created_at: state.server_time });
        }
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    const dashboard = page.getByRole('region', { name: 'Daily todos' });
    await expect(dashboard.locator('.todo-row').first()).toContainText('Get groceries');
    await expect(dashboard).toContainText('Carried from 2020-01-01'); await expect(dashboard).not.toContainText('Renew passport');
    await page.getByRole('navigation').getByRole('button', { name: 'Quests', exact: true }).click();
    const list = page.getByRole('region', { name: 'Daily todos' });
    await list.getByLabel('New todo', { exact: true }).fill('Take out recycling');
    await list.getByRole('button', { name: 'Add todo' }).click();
    await expect(list).toContainText('Take out recycling');
    expect(submitted).toMatchObject({ title: 'Take out recycling', difficulty: 'medium', attribute: null, planned_on: today, due_local: null });
    await list.getByText('Options · 25 XP', { exact: true }).click();
    await list.getByLabel('Difficulty', { exact: true }).selectOption('hard');
    await list.getByLabel('Todo attribute').selectOption('Vitality');
    await list.getByLabel('Optional deadline (UTC)').fill('2099-01-01T12:00');
    await expect(list).toContainText('On time: +50 XP / +1 Vitality');
    await expect(list).toContainText('Late: +37 XP (−13 XP) / −1 Vitality');
    await list.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(list.locator('.todo-list')).toContainText('Renew passport');
    await list.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    const groceries = list.locator('.todo-row').filter({ has: page.getByRole('heading', { name: 'Get groceries', exact: true }) });
    await groceries.getByRole('checkbox').click(); await expect(groceries.getByRole('checkbox')).toBeChecked();
    await expect(page.getByText('+18 XP · -1 Discipline confirmed', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0))).toBeGreaterThan(0);
    await groceries.getByText('Completion history', { exact: true }).click();
    await expect(groceries).toContainText('applied +18 XP / −1 Discipline');
    await groceries.getByRole('checkbox').click(); await expect(groceries.getByRole('checkbox')).not.toBeChecked();
    await expect(groceries).toContainText('Unchecked');
    expect(await page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0))).toBeGreaterThan(0);
    await groceries.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(groceries).toContainText('Only title corrections');
    await groceries.getByLabel('Todo title').fill('Buy groceries');
    await groceries.getByRole('button', { name: 'Save todo' }).click();
    expect(submitted).toEqual({ id: 'late', title: 'Buy groceries' });
    await expect(list.getByRole('button', { name: 'Add todo' })).toBeEnabled();
    for (const theme of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: `/tmp/orion-todos-${theme}-${width}.png`, fullPage: true });
        }
    }
    await list.getByRole('button', { name: 'Todo history' }).click(); await expect(list).toContainText('Buy groceries');
});

test('recovery and habit boxes can be unchecked and recovery plays a confirmed completion chime', async ({ page }) => {
    const state = fixture(); await mock(page, state);
    await page.addInitScript(() => {
        localStorage.setItem('orion-sound', 'on');
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            document.documentElement.dataset.soundNotes = String(Number(document.documentElement.dataset.soundNotes ?? 0) + 1);
            return original.call(this);
        };
    });
    let sequence = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { action, payload } = route.request().postDataJSON();
        const recovery = action === 'recovery';
        const key = recovery ? `recovery:${payload.target}` : `habit:${payload.id}`;
        const dailyKey = key + ':' + state.server_time.slice(0, 10);
        sequence++;
        if (payload.completed) {
            state.activities.push({ ...state.activities[0]!, id: 'daily-' + sequence, kind: recovery ? 'recovery' : 'habit', daily_key: dailyKey });
        } else state.activities = state.activities.filter(activity => activity.daily_key !== dailyKey);
        state.events.push({ id: String(sequence), source: payload.completed ? key + ':' + sequence : 'daily-undo:' + sequence, xp: payload.completed ? 10 : -10, attributes: {}, created_at: new Date().toISOString() });
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    const notes = () => page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0));
    const water = page.getByRole('button', { name: 'Water: 2 litres', exact: true });
    await expect(water).toHaveAttribute('aria-pressed', 'false');
    await water.click(); await expect(water).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(notes).toBeGreaterThan(0);
    const completedNotes = await notes();
    await page.getByRole('button', { name: 'Dismiss reward' }).click();
    await water.click(); await expect(water).toHaveAttribute('aria-pressed', 'false');
    expect(await notes()).toBe(completedNotes);
    await page.getByRole('button', { name: 'Dismiss reward' }).click();
    await water.click(); await expect(water).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(notes).toBeGreaterThan(completedNotes);
    const habit = page.getByRole('button', { name: 'Read before bed', exact: true });
    await habit.click(); await expect(habit).toHaveAttribute('aria-pressed', 'true');
    await habit.click(); await expect(habit).toHaveAttribute('aria-pressed', 'false');
});

for (const mode of ['full', 'reduced', 'off', 'system-reduced'] as const) {
    test(`rank reveal is accessible and respects ${mode} effects`, async ({ page }) => {
        const state = fixture(); state.profile.xp = threshold(10) - 1;
        await mock(page, state);
        await page.addInitScript(effects => { if (!localStorage.getItem('orion-effects')) localStorage.setItem('orion-effects', effects); }, mode === 'system-reduced' ? 'full' : mode);
        if (mode === 'system-reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route('**/rest/v1/rpc/orion_command', async route => {
            state.profile.xp = threshold(10) + 100; state.profile.attributes.Strength += 2;
            state.events.push({ id: 'rank-reward', source: 'activity:' + route.request().postDataJSON().command_id, xp: 101, attributes: { Strength: 2 }, created_at: new Date().toISOString() });
            await route.fulfill({ json: { saved: true, personal_record: true } });
        });
        await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
        const save = page.getByRole('button', { name: 'Save activity', exact: true }); await save.click();
        const dialog = page.getByRole('dialog', { name: 'Rank D unlocked' }); await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('data-effects', mode === 'system-reduced' ? 'reduced' : mode);
        await expect(dialog).toContainText('+101 XP'); await expect(dialog).toContainText('+2 Strength');
        await expect(dialog.locator('.reward-particles')).toHaveCount(mode === 'full' ? 1 : 0);
        await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
        for (const theme of ['dark', 'light']) {
            await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
            for (const width of [320, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                if (mode === 'full') await page.screenshot({ path: `/tmp/orion-rank-${theme}-${width}.png` });
            }
        }
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(save).toBeFocused();
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByLabel('Visual effects')).toHaveValue(mode === 'system-reduced' ? 'full' : mode);
        await page.getByLabel('Visual effects').selectOption('off'); await page.reload();
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click(); await expect(page.getByLabel('Visual effects')).toHaveValue('off');
    });
}
test('background progress is a silent recap and never takes over the screen or replays', async ({ page }) => {
    const state = fixture(); await mock(page, state); await countAudio(page);
    await page.addInitScript(() => localStorage.setItem('orion-sound', 'on'));
    await page.goto('/'); await expect(page.getByRole('heading', { name: 'A little stronger.' })).toBeVisible();
    state.profile.xp = threshold(10); state.events.push({ id: 'remote', source: 'quest:remote', xp: 25, attributes: {}, created_at: new Date().toISOString() });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.reward-recap')).toContainText('Progress synced'); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => Number(document.documentElement.dataset.soundNotes ?? 0))).toBe(0);
    await page.getByRole('button', { name: 'Dismiss reward' }).click(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.reward-popup')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ordinary rewards queue without blocking navigation or combining unearned totals', async ({ page }) => {
    const state = fixture(); await mock(page, state); await page.setViewportSize({ width: 1440, height: 1400 });
    let sequence = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON(); sequence++; state.profile.xp += 10;
        state.events.push({ id: 'queued-' + sequence, source: 'activity:' + body.command_id, xp: 10, attributes: {}, created_at: new Date().toISOString() });
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByLabel('Title (optional)').fill('First entry'); await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.locator('.reward-popup h2')).toHaveText('First entry');
    await page.getByLabel('Title (optional)').fill('Second entry'); await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeEnabled();
    await expect(page.locator('.reward-popup h2')).toHaveText('First entry');
    await page.getByRole('navigation').getByRole('button', { name: 'Character', exact: true }).click();
    await expect(page.locator('.reward-popup h2')).toHaveText('First entry');
    await page.getByRole('button', { name: 'Dismiss reward' }).click(); await expect(page.locator('.reward-popup h2')).toHaveText('Second entry');
    await expect(page.locator('.reward-popup')).toContainText('+10 XP confirmed'); await expect(page.locator('.hud-energy-label')).toContainText('380 XP');
    await page.getByRole('button', { name: 'Dismiss reward' }).click(); await expect(page.locator('.reward-popup')).toHaveCount(0);
});
test('a confirmed save with a failed refresh defers its milestone until the snapshot recovers', async ({ page }) => {
    const state = fixture(); await mock(page, state); let failNextRead = false;
    await page.route('**/rest/v1/rpc/orion_snapshot', async route => {
        if (failNextRead) { failNextRead = false; await route.abort('failed'); } else await route.fulfill({ json: state });
    });
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON(); state.profile.xp = 675;
        state.events.push({ id: 'deferred', source: 'activity:' + body.command_id, xp: 315, attributes: {}, created_at: new Date().toISOString() });
        failNextRead = true; await route.fulfill({ json: { saved: true, personal_record: true } });
    });
    await page.goto('/'); await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Saved successfully'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('New personal record');
    await expect(page.getByRole('dialog')).toContainText('Level 4 reached'); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Save activity', exact: true })).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reduced and off effects remove motion from ordinary popup roots as well as their children', async ({ page }) => {
    const state = fixture(); await mock(page, state); let sequence = 0;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        sequence++; const body = route.request().postDataJSON(); state.profile.xp += 10;
        state.events.push({ id: 'motion-' + sequence, source: 'activity:' + body.command_id, xp: 10, attributes: {}, created_at: new Date().toISOString() });
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    for (const mode of ['reduced', 'off']) {
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByLabel('Visual effects').selectOption(mode);
        await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
        await page.getByRole('button', { name: 'Save activity', exact: true }).click();
        await expect(page.locator('.reward-popup')).toHaveAttribute('data-effects', mode);
        expect(await page.locator('.reward-popup').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
        await expect(page.locator('.reward-particles')).toHaveCount(0);
        if (mode === 'off') await expect(page.locator('.reward-emblem')).toHaveCount(0);
        await page.getByRole('button', { name: 'Dismiss reward' }).click();
    }
});

function missionFixture(): Snapshot {
    const state = fixture();
    state.quests = [{ ...state.quests[0]!, title: 'Build your momentum', period: 'one-off', timeline: 'weekly', status: 'active', description: 'Train with intention and prepare for the next session.', starts_at: '2026-01-01T12:00:00Z', ends_at: '2099-01-08T12:00:00Z', due_at: '2099-01-08T12:00:00Z', reward_xp: 100, reward_points: 3, attribute: 'Strength', target: 3, progress: 1, objectives: [
        { id: 'o1', ordinal: 1, title: 'Pack your training kit', metric: 'checklist', target: 1, progress: 0, activity_kind: null, attribute: null },
        { id: 'o2', ordinal: 2, title: 'Complete three workouts', metric: 'workouts', target: 3, progress: 3, activity_kind: null, attribute: null },
        { id: 'o3', ordinal: 3, title: 'Practice your routine', metric: 'manual', target: 2, progress: 1, activity_kind: null, attribute: null },
    ] }];
    return state;
}
test('mission journal supports objective updates, completion archive, themes and mobile layouts', async ({ page }) => {
    const state = missionFixture(); await mock(page, state);
    const calls: { action: string; payload: Record<string, unknown> }[] = [];
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { action, payload } = route.request().postDataJSON(); calls.push({ action, payload });
        const q = state.quests[0]!;
        if (action === 'set_quest_objective') {
            q.objectives!.find(o => o.id === payload.objective_id)!.progress = payload.progress;
            q.progress = q.objectives!.filter(o => o.progress >= o.target).length;
            if (q.progress === q.target) { q.status = 'completed'; q.completed_at = new Date().toISOString(); state.profile.xp += 100; state.profile.attributes.Strength += 3; state.events.push({ id: 'mission-earned', source: `quest:${q.id}`, xp: 100, attributes: { Strength: 3 }, created_at: q.completed_at }); }
        }
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quest journal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Objective path' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Quest roster' }).getByRole('button').focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Quest details' })).toBeFocused();
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/orion-quests-${theme}-${width}.png`, fullPage: true });
        }
    }
    await page.getByRole('checkbox', { name: 'Complete Pack your training kit' }).click();
    await expect(page.getByRole('checkbox', { name: 'Complete Pack your training kit', exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Complete Pack your training kit', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Complete Pack your training kit' })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Complete Pack your training kit' }).click();
    await page.getByLabel('Completed count for Practice your routine').fill('2'); await page.getByRole('button', { name: 'Save count' }).click();
    await expect(page.getByRole('status').filter({ hasText: '+100 XP' })).toBeVisible();
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.getByText('Achievement secured.', { exact: false })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(calls.filter(c => c.action === 'set_quest_objective')).toHaveLength(4);
    expect(calls.at(-1)!.payload).toEqual({ id: 'q', objective_id: 'o3', progress: 2 });
});
test('quest builder persists drafts and accepts mixed objectives with canonical units', async ({ page }) => {
    const state = missionFixture(); state.profile.units = 'imperial'; await mock(page, state);
    let submitted: Record<string, unknown> = {};
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { action, payload } = route.request().postDataJSON();
        if (action === 'create_quest') { submitted = payload; state.definitions.push({ ...state.quests[0]!, id: payload.id }); }
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/'); const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('button', { name: 'Quests', exact: true }).click(); await page.getByRole('button', { name: 'Create quest', exact: true }).click();
    await page.getByLabel('Quest title', { exact: true }).fill('My first expedition');
    await navigation.getByRole('button', { name: 'Character', exact: true }).click(); await navigation.getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('button', { name: 'Create quest', exact: true }).click(); await expect(page.getByLabel('Quest title', { exact: true })).toHaveValue('My first expedition');
    await page.getByLabel('Objective title', { exact: true }).fill('Prepare route'); await page.getByRole('button', { name: 'Add objective', exact: true }).click();
    const second = page.locator('.objective-draft').nth(1); await second.getByLabel('Objective title', { exact: true }).fill('Run two miles');
    await second.getByLabel('Progress from').selectOption('metres'); await second.getByLabel('Target (mi)').fill('2');
    await second.getByLabel('Activity filter').selectOption('running'); await second.getByLabel('Attribute filter').selectOption('Endurance');
    await page.getByRole('combobox', { name: 'Timeline', exact: true }).selectOption('custom'); await page.getByLabel('Deadline (UTC)', { exact: true }).fill('2099-01-01T12:00');
    await page.setViewportSize({ width: 320, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Accept quest', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Quest accepted' })).toBeVisible();
    expect(submitted.title).toBe('My first expedition'); expect(submitted.timeline).toBe('custom'); expect(submitted.due_local).toBe('2099-01-01T12:00');
    expect(submitted.objectives).toEqual([{ title: 'Prepare route', metric: 'checklist', target: 1, activity_kind: null, attribute: null }, { title: 'Run two miles', metric: 'metres', target: 3218.688, activity_kind: 'running', attribute: 'Endurance' }]);
    await page.getByRole('button', { name: 'Create another quest' }).click(); await expect(page.getByLabel('Quest title', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Build your momentum', exact: true }).click(); await expect(page.getByLabel('Quest title', { exact: true })).toHaveValue('Build your momentum');
});
test('past missions show expiry and abandonment without completion controls', async ({ page }) => {
    const state = missionFixture(); state.quests[0]!.status = 'expired'; state.quests[0]!.ends_at = '2020-01-01T00:00:00Z'; await mock(page, state);
    await page.goto('/'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('button', { name: 'Past', exact: true }).click(); await expect(page.getByText('The deadline passed.', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: 'Save count' })).toHaveCount(0);
    state.quests[0]!.status = 'active'; state.quests[0]!.ends_at = '2099-01-01T00:00:00Z'; await page.reload(); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await page.route('**/rest/v1/rpc/orion_command', async route => { state.quests[0]!.status = 'abandoned'; state.quests[0]!.archived = true; await route.fulfill({ json: { saved: true } }); });
    await page.getByRole('button', { name: 'Abandon quest', exact: true }).click(); await page.getByRole('button', { name: 'Confirm abandonment' }).click();
    await page.getByRole('button', { name: 'Past', exact: true }).click(); await expect(page.getByText('This attempt was closed', { exact: false })).toBeVisible();
});

test('uncertain quest acceptance retries the same ID and cannot duplicate the saved draft', async ({ page }) => {
    const state = missionFixture(); state.quests = []; await mock(page, state);
    const ids: string[] = []; let first = true;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { command_id, payload } = route.request().postDataJSON(); ids.push(command_id);
        if (first) { first = false; state.definitions.push({ ...fixture().quests[0]!, id: payload.id }); await route.abort('failed'); }
        else await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('button', { name: 'Create quest', exact: true }).click(); await page.getByLabel('Quest title', { exact: true }).fill('One attempt'); await page.getByLabel('Objective title', { exact: true }).fill('Do the thing');
    await page.getByRole('button', { name: 'Accept quest', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept quest', exact: true })).toBeDisabled();
    await page.reload(); await page.getByRole('button', { name: 'Retry save' }).click(); await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click(); await page.getByRole('button', { name: 'Create quest', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quest accepted' })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    await expect(page.getByRole('button', { name: 'Accept quest', exact: true })).toHaveCount(0);
});
