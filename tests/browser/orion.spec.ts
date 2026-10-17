import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { threshold } from '../../src/orion/logic';
import type { Boss, BossRequirement, Snapshot } from '../../src/orion/types';

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
test('all eight screens fit mobile through desktop in both themes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mock(page); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const tab of ['Dashboard', 'Todos', 'Quests', 'Bosses', 'Training', 'Journal', 'Character', 'Settings']) {
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
    await page.getByText('More details', { exact: true }).click();
    await page.getByLabel('Title (optional)').fill('Evening lift');
    await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
    await page.getByLabel('Search exercises').fill('incline');
    await page.getByRole('button', { name: 'Incline dumbbell press', exact: false }).click();
    await page.getByLabel('Reps', { exact: true }).fill('8'); await page.getByLabel('kg', { exact: true }).fill('22.5');
    await page.getByRole('navigation').getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await page.getByText('More details', { exact: true }).click();
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
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Bosses', exact: true }).click();
    await page.getByText('Classic encounters', { exact: true }).click();
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
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.getByText('Your first session is a starting point. Log it above.')).toBeVisible();
});
test('active boss and long player content fit the smallest viewport', async ({ page }) => {
    const state = fixture();
    state.profile.display_name = 'A'.repeat(60);
    state.quests[0]!.title = 'Q'.repeat(120);
    state.habits[0]!.name = 'H'.repeat(100);
    state.bosses = [{ ...state.templates[0]!, id: 'boss', template_id: 'first-gate', accepted_at: new Date(Date.now() - 1000).toISOString(), deadline: new Date(Date.now() + 1000 * 86400).toISOString(), resolved_at: null, status: 'active' }];
    await mock(page, state); await page.setViewportSize({ width: 320, height: 900 }); await page.goto('/');
    for (const tab of ['Dashboard', 'Todos', 'Quests', 'Bosses', 'Training', 'Journal', 'Character', 'Settings']) {
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
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Data and account', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Appearance and sound', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Appearance and sound', exact: true }).click();
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
    await page.getByRole('navigation').getByRole('button', { name: 'Todos', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Upcoming', exact: true }).click();
    await expect(list.locator('.todo-list')).toContainText('Renew passport');
    await page.getByRole('tab', { name: 'Today', exact: true }).click();
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
    await page.getByRole('tab', { name: 'History' }).click(); await expect(list).toContainText('Buy groceries');
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
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('tab', { name: 'Appearance and sound', exact: true }).click();
        await expect(page.getByLabel('Visual effects')).toHaveValue(mode === 'system-reduced' ? 'full' : mode);
        await page.getByLabel('Visual effects').selectOption('off'); await page.reload();
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('tab', { name: 'Appearance and sound', exact: true }).click(); await expect(page.getByLabel('Visual effects')).toHaveValue('off');
    });
}
test('background progress is a silent recap and never takes over the screen or replays', async ({ page }) => {
    const state = fixture(); await mock(page, state); await countAudio(page);
    await page.addInitScript(() => localStorage.setItem('orion-sound', 'on'));
    await page.goto('/'); await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
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
        await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('tab', { name: 'Appearance and sound', exact: true }).click();
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
    await expect(page.getByRole('dialog', { name: 'Quest complete: Build your momentum', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('combobox', { name: 'Quest status', exact: true }).selectOption('completed');
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
    await page.getByRole('dialog').getByLabel('Quest title', { exact: true }).fill('My first expedition');
    await page.getByRole('button', { name: 'Back to journal', exact: true }).click(); await navigation.getByRole('button', { name: 'Character', exact: true }).click(); await navigation.getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('button', { name: 'Create quest', exact: true }).click(); await expect(page.getByRole('dialog').getByLabel('Quest title', { exact: true })).toHaveValue('My first expedition');
    await page.getByLabel('Objective title', { exact: true }).fill('Prepare route'); await page.getByRole('button', { name: 'Add objective', exact: true }).click();
    const second = page.locator('.objective-draft').nth(1); await second.getByLabel('Objective title', { exact: true }).fill('Run two miles');
    await second.getByLabel('Progress from').selectOption('metres'); await second.getByLabel('Target (mi)').fill('2');
    await second.getByLabel('Activity filter').selectOption('running'); await second.getByLabel('Attribute filter').selectOption('Endurance');
    await page.getByRole('combobox', { name: 'Timeline', exact: true }).selectOption('custom'); await page.getByLabel('Deadline (UTC)', { exact: true }).fill('2099-01-01T12:00');
    await page.setViewportSize({ width: 320, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Accept quest', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Quest accepted' })).toBeVisible();
    expect(submitted.title).toBe('My first expedition'); expect(submitted.timeline).toBe('custom'); expect(submitted.due_local).toBe('2099-01-01T12:00');
    expect(submitted.objectives).toEqual([{ title: 'Prepare route', metric: 'checklist', target: 1, activity_kind: null, attribute: null }, { title: 'Run two miles', metric: 'metres', target: 3218.688, activity_kind: 'running', attribute: 'Endurance' }]);
    await page.getByRole('button', { name: 'Create another quest' }).click(); await expect(page.getByRole('dialog').getByLabel('Quest title', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Build your momentum', exact: true }).click(); await expect(page.getByRole('dialog').getByLabel('Quest title', { exact: true })).toHaveValue('Build your momentum');
});
test('past missions show expiry and abandonment without completion controls', async ({ page }) => {
    const state = missionFixture(); state.quests[0]!.status = 'expired'; state.quests[0]!.ends_at = '2020-01-01T00:00:00Z'; await mock(page, state);
    await page.goto('/'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('combobox', { name: 'Quest status', exact: true }).selectOption('past'); await expect(page.getByText('The deadline passed.', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: 'Save count' })).toHaveCount(0);
    state.quests[0]!.status = 'active'; state.quests[0]!.ends_at = '2099-01-01T00:00:00Z'; await page.reload(); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click();
    await page.route('**/rest/v1/rpc/orion_command', async route => { state.quests[0]!.status = 'abandoned'; state.quests[0]!.archived = true; await route.fulfill({ json: { saved: true } }); });
    await page.getByRole('button', { name: 'Abandon quest', exact: true }).click(); await page.getByRole('button', { name: 'Confirm abandonment' }).click();
    await page.getByRole('combobox', { name: 'Quest status', exact: true }).selectOption('past'); await expect(page.getByText('This attempt was closed', { exact: false })).toBeVisible();
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
    await page.getByRole('button', { name: 'Accept quest', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('button', { name: 'Retry save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept quest', exact: true })).toBeDisabled();
    await page.reload(); await page.getByRole('button', { name: 'Retry save' }).click(); await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Quests', exact: true }).click(); await page.getByRole('button', { name: 'Create quest', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quest accepted' })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    await expect(page.getByRole('button', { name: 'Accept quest', exact: true })).toHaveCount(0);
});


test('structured quest controls fit both themes and retain accessible interaction states', async ({ page }) => {
    await mock(page); await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('button', { name: 'Create quest', exact: true }).click();
    const title = page.getByLabel('Quest title', { exact: true });
    const accept = page.getByRole('button', { name: 'Accept quest', exact: true });
    await expect(page.getByRole('group', { name: 'Quest details', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Timeline and rewards', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove objective 1', exact: true })).toBeDisabled();
    await accept.click();
    await expect(title).toBeFocused();
    expect(await title.evaluate(el => el.matches(':user-invalid'))).toBe(true);
    await title.fill('An expedition with a long title '.repeat(3));
    await page.getByRole('button', { name: 'Add objective', exact: true }).click();
    await page.locator('.objective-draft').nth(1).getByLabel('Progress from').selectOption('metres');
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await accept.scrollIntoViewIfNeeded();
            const bounds = await accept.boundingBox();
            expect(bounds!.height).toBeGreaterThanOrEqual(44);
            await page.screenshot({ path: `/tmp/orion-controls-${theme}-${width}.png`, fullPage: true });
        }
    }
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await page.keyboard.press('Tab');
    await accept.focus();
    await expect(accept).toBeFocused();
    expect(await accept.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await accept.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
    expect(await accept.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    await page.screenshot({ path: '/tmp/orion-controls-forced-colors.png', fullPage: true });
});

test('sectioned journal and preferences preserve their command payloads', async ({ page }) => {
    await mock(page); await page.goto('/');
    const navigation = page.getByRole('navigation');
    await navigation.getByRole('button', { name: 'Journal', exact: true }).click();
    await page.getByLabel('Title (optional)').fill('Evening reading');
    await page.getByLabel('Notes (optional)').fill('One useful idea');
    const activityRequest = page.waitForRequest(r => r.url().endsWith('orion_command'));
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    expect((await activityRequest).postDataJSON().payload).toMatchObject({ kind: 'reading', title: 'Evening reading', minutes: 30, notes: 'One useful idea', sets: [] });
    await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Display name').fill('New player');
    await page.getByLabel('Timezone', { exact: true }).fill('Asia/Kolkata');
    await page.getByRole('combobox', { name: 'Units', exact: true }).selectOption('imperial');
    await page.getByLabel('Connection', { exact: true }).check();
    const profileRequest = page.waitForRequest(r => r.url().endsWith('orion_command'));
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    expect((await profileRequest).postDataJSON().payload).toEqual({ display_name: 'New player', timezone: 'Asia/Kolkata', units: 'imperial', domains: ['Strength', 'Intellect', 'Connection'] });
});


test('quest popup traps focus, restores its launcher and keeps a dismissed draft', async ({ page }) => {
    await mock(page); await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Quests', exact: true }).click();
    const launcher = page.getByRole('button', { name: 'Create quest', exact: true });
    await launcher.click();
    const dialog = page.getByRole('dialog', { name: 'Create quest', exact: true });
    await expect(dialog).toBeVisible();
    await page.getByLabel('Quest title', { exact: true }).fill('Across the starlit gate');
    await page.getByRole('button', { name: 'Back to journal', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await launcher.click(); await expect(page.getByLabel('Quest title', { exact: true })).toHaveValue('Across the starlit gate');
    for (const theme of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            const scroll = page.locator('.quest-dialog-scroll');
            expect(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            await scroll.evaluate(el => el.scrollTop = 0);
            await page.screenshot({ path: `/tmp/orion-quest-popup-${theme}-${width}.png` });
        }
    }
});


test('running date warning explains zero progress and a qualifying final run celebrates the quest', async ({ page }) => {
    const state = missionFixture(); state.profile.xp = 9000;
    const q = state.quests[0]!;
    Object.assign(q, { title: 'Run 20 km this month', timeline: 'monthly', attribute: 'Endurance', reward_xp: 300, reward_points: 8, target: 1, progress: 0, starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: '2099-01-01T00:00:00Z', objectives: [{ id: 'distance', ordinal: 1, title: 'Run your distance', metric: 'metres', target: 20000, progress: 0, activity_kind: 'running', attribute: null }] });
    await mock(page, state);
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'activity') {
            expect(body.payload.metres).toBe(20000);
            expect(new Date(body.payload.occurred_at).getTime()).toBeGreaterThan(new Date(q.starts_at).getTime());
            q.objectives![0]!.progress = 20000; q.progress = 1; q.status = 'completed'; q.completed_at = new Date().toISOString();
            state.profile.xp += 330; state.profile.attributes.Endurance += 9;
            state.events.push({ id: 'final-run', source: `activity:${body.command_id}`, xp: 30, attributes: { Endurance: 1 }, created_at: q.completed_at }, { id: 'distance-earned', source: `quest:${q.id}`, xp: 300, attributes: { Endurance: 8 }, created_at: q.completed_at });
        }
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await page.getByRole('button', { name: 'Running', exact: true }).click();
    await page.getByLabel('Duration (minutes)', { exact: true }).fill('30');
    await page.getByLabel('Distance (km)', { exact: true }).fill('20');
    await page.getByText('More details', { exact: true }).click();
    await page.getByLabel('Date and time (UTC)').fill('2000-01-01T12:19');
    await expect(page.getByText('This date falls outside a quest’s tracking window')).toBeVisible();
    await expect(page.locator('.activity-quest-timing')).toContainText('This entry can be saved, but it will not advance that quest');
    await page.getByRole('button', { name: 'Use current time', exact: true }).click();
    await expect(page.locator('.activity-quest-timing')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    const celebration = page.getByRole('dialog', { name: 'Quest complete: Run 20 km this month', exact: true });
    await expect(celebration).toBeVisible();
    await expect(celebration).toContainText('+330');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Quests', exact: true }).click();
    await page.getByRole('combobox', { name: 'Quest status', exact: true }).selectOption('completed');
    await expect(page.getByRole('heading', { name: 'Run 20 km this month', exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
});


test.describe('profile timezone independent of the device', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });
    test('Kolkata training and journal dates save UTC instants and corrections keep their time', async ({ page }) => {
        const state = fixture(); state.profile.timezone = 'Asia/Kolkata';
        state.server_time = '2026-10-16T08:00:00Z'; state.activities[0]!.occurred_at = '2026-10-16T06:49:00.123Z';
        await page.clock.install({ time: new Date(state.server_time) });
        await mock(page, state); await page.goto('/');
        const navigation = page.getByRole('navigation');
        await navigation.getByRole('button', { name: 'Training', exact: true }).click();
        await page.getByText('More details', { exact: true }).click();
        const date = page.getByLabel('Date and time (Asia/Kolkata)', { exact: true });
        await expect(date).toHaveValue('2026-10-16T13:30');
        await page.getByRole('button', { name: 'Running', exact: true }).click();
    await page.getByLabel('Duration (minutes)', { exact: true }).fill('30');
        await page.getByLabel('Distance (km)', { exact: true }).fill('20');
        await date.fill('2026-10-16T12:20:44');
        const request = page.waitForRequest(r => r.url().endsWith('orion_command'));
        await page.getByRole('button', { name: 'Save activity', exact: true }).click();
        expect((await request).postDataJSON().payload.occurred_at).toBe('2026-10-16T06:50:44.000Z');
        await page.getByRole('tab', { name: 'History', exact: true }).click();
        await expect(page.locator('.history-entry time')).toContainText('12:19');
        await page.getByRole('button', { name: 'Correct entry', exact: true }).click();
        const correction = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Correct activity', exact: true }) });
        await correction.getByText('More details', { exact: true }).click();
        await expect(correction.getByLabel('Date and time (Asia/Kolkata)')).toHaveValue('2026-10-16T12:19');
        const corrected = page.waitForRequest(r => r.url().endsWith('orion_command'));
        await correction.getByRole('button', { name: 'Save correction', exact: true }).click();
        expect((await corrected).postDataJSON().payload.occurred_at).toBe('2026-10-16T06:49:00.123Z');
        await navigation.getByRole('button', { name: 'Journal', exact: true }).click();
        await page.getByLabel('Date and time (Asia/Kolkata)').fill('2026-10-16T00:15');
        const journal = page.waitForRequest(r => r.url().endsWith('orion_command'));
        await page.getByRole('button', { name: 'Save activity', exact: true }).click();
        expect((await journal).postDataJSON().payload.occurred_at).toBe('2026-10-15T18:45:00.000Z');
    });

    test('Use current time preserves the later occurrence of a repeated DST hour', async ({ page }) => {
        const state = fixture(); state.profile.timezone = 'America/New_York';
        state.server_time = '2026-11-01T06:30:20Z';
        await page.clock.setFixedTime(new Date(state.server_time));
        await mock(page, state); await page.goto('/');
        const navigation = page.getByRole('navigation');
        await navigation.getByRole('button', { name: 'Training', exact: true }).click();
        await page.getByRole('button', { name: 'Running', exact: true }).click();
    await page.getByLabel('Duration (minutes)', { exact: true }).fill('30');
        await page.getByLabel('Distance (km)').fill('5');
        await page.getByText('More details', { exact: true }).click();
        await page.getByRole('button', { name: 'Use current time', exact: true }).click();
        await navigation.getByRole('button', { name: 'Journal', exact: true }).click();
        await navigation.getByRole('button', { name: 'Training', exact: true }).click();
        await expect(page.getByLabel('Date and time (America/New_York)')).toHaveValue('2026-11-01T01:30:20');
        const request = page.waitForRequest(r => r.url().endsWith('orion_command'));
        await page.getByRole('button', { name: 'Save activity', exact: true }).click();
        expect((await request).postDataJSON().payload.occurred_at).toBe('2026-11-01T06:30:20.000Z');
    });

    test('old device-time drafts and profile timezone changes preserve the draft instant', async ({ page }) => {
        const state = fixture(); state.profile.timezone = 'Asia/Kolkata';
        await mock(page, state);
        await page.addInitScript(({ uid }) => localStorage.setItem(`orion-draft:${uid}:training:metric`, JSON.stringify({ id: crypto.randomUUID(), kind: 'running', title: 'Saved run', minutes: '30', distance: '20', date: '2026-10-16T01:00:00', notes: '', sets: [] })), { uid });
        await page.route('**/rest/v1/rpc/orion_command', async route => {
            const body = route.request().postDataJSON();
            if (body.action === 'profile') state.profile.timezone = body.payload.timezone;
            await route.fulfill({ json: { saved: true } });
        });
        await page.goto('/');
        const navigation = page.getByRole('navigation');
        await navigation.getByRole('button', { name: 'Training', exact: true }).click();
        await page.getByText('More details', { exact: true }).click();
        await expect(page.getByLabel('Date and time (Asia/Kolkata)')).toHaveValue('2026-10-16T13:30');
        await expect(page.getByLabel('Title (optional)')).toHaveValue('Saved run');
        await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByLabel('Timezone', { exact: true }).fill('UTC');
        await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
        await expect(page.locator('.notification')).toContainText('Saved to your account');
        await navigation.getByRole('button', { name: 'Training', exact: true }).click();
        await page.getByText('More details', { exact: true }).click();
        await expect(page.getByLabel('Date and time (UTC)')).toHaveValue('2026-10-16T08:00');
        await expect(page.getByLabel('Title (optional)')).toHaveValue('Saved run');
    });
});


function dashboardFixture() {
    const state = fixture();
    const base = state.quests[0]!;
    state.quests = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `mission-${i}`, title: i === 0 ? 'Run 20 km' : `Expedition ${i}`, timeline: 'monthly' as const, status: 'active' as const, period: 'one-off' as const, target: 1, progress: 0, attribute: 'Endurance' as const, ends_at: new Date(Date.now() + (i + 2) * 86400000).toISOString(), objectives: [{ id: `distance-${i}`, ordinal: 1, title: 'Find your distance', metric: 'metres' as const, target: 20000, progress: 12500, activity_kind: 'running' as const, attribute: null }] }));
    state.quests.push(...Array.from({ length: 8 }, (_, i) => ({ ...base, id: `todo-${i}`, title: `Today task ${i}`, kind: 'todo' as const, planned_on: state.server_time.slice(0, 10), period: 'one-off' as const, ends_at: null })));
    state.habits = Array.from({ length: 7 }, (_, i) => ({ id: `habit-${i}`, name: `Daily ritual ${i}`, archived: false }));
    state.bosses = [{ ...state.templates[0]!, id: 'active-boss', template_id: 'first-gate', accepted_at: new Date(Date.now() - 3600000).toISOString(), deadline: new Date(Date.now() + 86400000).toISOString(), status: 'active', resolved_at: null }];
    return state;
}

test('mission dashboard bounds its lists, exposes real progress and navigates to the selected mission or section', async ({ page }) => {
    await mock(page, dashboardFixture()); await page.goto('/');
    await expect(page.locator('.dashboard-quest-row')).toHaveCount(3);
    await expect(page.locator('.todos-compact .todo-row')).toHaveCount(5);
    await expect(page.locator('.daily-care-compact .habit-complete')).toHaveCount(5);
    await expect(page.locator('.daily-care-compact .recovery-grid button')).toHaveCount(4);
    await expect(page.locator('.dashboard-quest-row').first()).toContainText('12.5 / 20 km');
    await expect(page.getByText('Your week in motion', { exact: true })).toHaveCount(0);
    await expect(page.locator('.dashboard-quests')).toContainText('2 more');
    await expect(page.locator('.todos-compact')).toContainText('3 more');
    await page.locator('.dashboard-quest-row').nth(1).click();
    await expect(page.getByRole('region', { name: 'Quest details', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Quest details', exact: true })).toContainText('Expedition 1');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'View encounter', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Boss details', exact: true })).toBeFocused();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Manage todos', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Daily todos', exact: true })).toBeFocused();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Manage daily rhythm', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Daily rhythm', exact: true })).toBeFocused();
});

test('compact dashboard keeps quests and boss visible in both themes across viewport sizes', async ({ page }) => {
    await mock(page, dashboardFixture()); await page.goto('/');
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            const height = width === 390 ? 844 : 900;
            await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: `/tmp/orion-command-deck-${theme}-${width}.png`, fullPage: true });
            if (width === 390 || width === 1440) {
                const quest = await page.locator('.dashboard-quest-row').nth(width === 1440 ? 2 : 0).boundingBox();
                const boss = await page.locator('.dashboard-boss').boundingBox();
                expect(quest!.y + quest!.height).toBeLessThanOrEqual(height);
                expect(boss!.y + boss!.height).toBeLessThanOrEqual(height);
            }
        }
    }
});

test('completion controls wait for confirmation, animate only local changes, and handle rejection and retry', async ({ page }) => {
    const state = fixture(); await mock(page, state);
    let release: (() => void) | undefined;
    let mode: 'delay' | 'reject' | 'uncertain' | 'confirm' = 'delay';
    const ids: string[] = [];
    const started: string[] = [];
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON(); ids.push(body.command_id);
        if (mode === 'delay') await new Promise<void>(resolve => { release = resolve; });
        if (mode === 'reject') { await route.fulfill({ status: 400, json: { code: 'P0001', message: 'Try another target' } }); return; }
        if (mode === 'uncertain') { await route.abort('failed'); return; }
        if (body.payload.completed) state.activities.push({ ...state.activities[0]!, id: 'water', kind: 'recovery', daily_key: 'recovery:Water: 2 litres:' + state.server_time.slice(0, 10) });
        else state.activities = state.activities.filter(a => a.id !== 'water');
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    await page.exposeFunction('recordCompletionAnimation', (name: string) => { started.push(name); });
    await page.evaluate(() => document.addEventListener('animationstart', event => {
        const record = Reflect.get(window, 'recordCompletionAnimation');
        if (event instanceof AnimationEvent && event.animationName.startsWith('completion-') && typeof record === 'function') void record(event.animationName);
    }));
    const water = page.getByRole('button', { name: 'Water: 2 litres', exact: true });
    await expect(water.locator('.completion-mark')).toHaveAttribute('data-phase', 'idle');
    await water.click(); await expect(water).toBeDisabled(); await expect(water).toHaveAttribute('aria-busy', 'true');
    await expect(water).toHaveAttribute('aria-pressed', 'false');
    await expect(water.locator('.completion-mark')).not.toHaveClass(/is-checked/);
    release!();
    await expect(water).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => started.includes('completion-confirm')).toBe(true);
    mode = 'reject'; await water.click(); await expect(page.getByRole('alert')).toContainText('Try another target');
    await expect(water).toHaveAttribute('aria-pressed', 'true'); await expect(water).toBeEnabled();
    mode = 'uncertain'; await water.click(); await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    await expect(water).toBeDisabled(); mode = 'confirm'; await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(water).toHaveAttribute('aria-pressed', 'false');
    expect(ids.at(-1)).toBe(ids.at(-2));
    await expect.poll(() => started.includes('completion-undo')).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await water.focus(); await page.keyboard.press('Space'); await expect(water).toHaveAttribute('aria-pressed', 'true');
    expect(await water.locator('.completion-mark').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.emulateMedia({ forcedColors: 'active' });
    const checkbox = page.getByRole('checkbox', { name: 'Strength', exact: true });
    await checkbox.focus(); await page.keyboard.press('Space'); await expect(checkbox).not.toBeChecked();
    expect(await checkbox.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    await page.screenshot({ path: '/tmp/orion-completion-forced-colors.png' });
});


test('empty dashboard and boss countdown remain truthful without local settlement', async ({ page }) => {
    const state = fixture(); state.quests = []; state.habits = [];
    await page.clock.install(); await mock(page, state); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'A new quest awaits' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review encounters', exact: true })).toBeVisible();
    await expect(page.getByText('Nothing pending today. Add a todo above.')).toBeVisible();
    await page.getByRole('button', { name: 'Choose a quest', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create your first quest' })).toBeVisible();
    const boss = dashboardFixture().bosses[0]!;
    state.bosses = [{ ...boss, deadline: new Date(Date.parse(state.server_time) + 1000).toISOString() }];
    await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.encounter-clock')).toHaveText('1m left');
    await page.clock.fastForward(31000);
    await expect(page.locator('.encounter-clock')).toHaveText('Awaiting settlement');
    expect(state.bosses[0]!.status).toBe('active');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('native todo checks remain unchecked during saves and effects off suppresses confirmation motion', async ({ page }) => {
    const state = dashboardFixture(); await mock(page, state);
    await page.addInitScript(() => localStorage.setItem('orion-effects', 'off'));
    let release: (() => void) | undefined;
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON();
        await new Promise<void>(resolve => { release = resolve; });
        const todo = state.quests.find(q => q.id === body.payload.id)!;
        todo.completed_at = state.server_time;
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Todos', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Complete Today task 0', exact: true });
    await checkbox.focus(); await page.keyboard.press('Space');
    await expect(checkbox).toBeDisabled(); await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toHaveAttribute('aria-busy', 'true');
    release!(); await expect(checkbox).toBeChecked();
    const mark = checkbox.locator('..').locator('.completion-mark');
    expect(await mark.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Complete Today task 0', exact: true })).toHaveCount(0);
});


test('dashboard creates todos with profile-local defaults and preserves the title on rejection', async ({ page }) => {
    const state = fixture(); state.profile.timezone = 'Asia/Kolkata'; state.server_time = '2026-10-16T20:00:00Z';
    await mock(page, state);
    let reject = true;
    const calls: Record<string, unknown>[] = [];
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const { action, payload } = route.request().postDataJSON();
        expect(action).toBe('todo'); calls.push(payload);
        if (reject) { await route.fulfill({ status: 400, json: { code: 'P0001', message: 'Please try again' } }); return; }
        state.quests.push({ ...state.quests[0]!, id: `new-todo-${calls.length}`, kind: 'todo', title: payload.title, period: 'one-off', metric: 'manual', target: 1, progress: 0, planned_on: payload.planned_on, attribute: payload.attribute, difficulty: payload.difficulty, due_at: null, ends_at: null, reward_xp: 25 });
        await route.fulfill({ json: { saved: true } });
    });
    await page.goto('/');
    const today = page.getByRole('region', { name: 'Daily todos', exact: true });
    await today.getByLabel('New todo', { exact: true }).fill('Pack running shoes');
    await today.getByRole('button', { name: 'Add todo', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Please try again');
    await expect(today.getByLabel('New todo', { exact: true })).toHaveValue('Pack running shoes');
    reject = false;
    await today.getByRole('button', { name: 'Add todo', exact: true }).click();
    await expect(today.getByRole('heading', { name: 'Pack running shoes', exact: true })).toBeVisible();
    await expect(today.getByLabel('New todo', { exact: true })).toHaveValue('');
    expect(calls.at(-1)).toEqual({ title: 'Pack running shoes', difficulty: 'medium', attribute: null, planned_on: '2026-10-17', due_local: null });
    expect(state.profile.xp).toBe(360);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await today.scrollIntoViewIfNeeded();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await expect(today.getByRole('button', { name: 'Add todo', exact: true })).toBeVisible();
        }
    }
});


test('all pages and subsections share header geometry, aligned panels and neutral surfaces', async ({ page }) => {
    test.setTimeout(120000);
    await mock(page, dashboardFixture()); await page.goto('/');
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            let baseline: { x: number; y: number; width: number; height: number } | undefined;
            for (const name of ['Dashboard', 'Todos', 'Quests', 'Bosses', 'Training', 'Journal', 'Character', 'Settings']) {
                await navigation.getByRole('button', { name, exact: true }).click();
                const header = page.locator('.page-header');
                const bounds = await header.boundingBox();
                expect(bounds).not.toBeNull();
                baseline ??= bounds!;
                expect(bounds!.x).toBeCloseTo(baseline.x, 0);
                expect(bounds!.y).toBeCloseTo(baseline.y, 0);
                expect(bounds!.width).toBeCloseTo(baseline.width, 0);
                expect(bounds!.height).toBe(baseline.height);
                const hud = await page.locator('.game-hud').boundingBox();
                expect(hud!.x).toBeCloseTo(bounds!.x, 0); expect(hud!.width).toBeCloseTo(bounds!.width, 0);
                const tabs = page.getByRole('tablist');
                const labels = await tabs.getByRole('tab').allTextContents();
                for (const label of labels.length ? labels : ['']) {
                    if (label) await tabs.getByRole('tab', { name: label, exact: true }).click();
                    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${label}/${width}`).toBe(true);
                    const panels = page.locator('.page-content .panel:visible');
                    for (const panel of await panels.all()) {
                        const panelBounds = await panel.boundingBox();
                        if (name !== 'Dashboard' && !(name === 'Character' && label === 'Overview')) {
                            expect(panelBounds!.x, `${name}/${label}`).toBeCloseTo(bounds!.x, 0);
                            expect(panelBounds!.width, `${name}/${label}`).toBeCloseTo(bounds!.width, 0);
                        }
                        const style = await panel.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius, surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }));
                        const headerStyle = await header.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius }));
                        expect(style.background, `${name}/${label}`).toBe(headerStyle.background);
                        expect(style.radius, `${name}/${label}`).toBe(headerStyle.radius);
                    }
                    if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/orion-uniform-${theme}-${name.toLowerCase()}-${label || 'overview'}-${width}.png`, fullPage: true });
                }
                if (name === 'Quests') await expect(page.getByRole('region', { name: 'Daily todos', exact: true })).toHaveCount(0);
            }
        }
    }
});

test('subsection keyboard navigation keeps drafts and remembers sections while dashboard shortcuts override them', async ({ page }) => {
    await mock(page, dashboardFixture()); await page.goto('/');
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('button', { name: 'Training', exact: true }).click();
    await page.getByText('More details', { exact: true }).click();
    await page.getByLabel('Title (optional)', { exact: true }).fill('Unfinished session');
    await page.getByRole('tab', { name: 'Log training', exact: true }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Exercises', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Exercise library', exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Log training', exact: true })).toBeFocused();
    await expect(page.getByLabel('Title (optional)', { exact: true })).toHaveValue('Unfinished session');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
    await navigation.getByRole('button', { name: 'Character', exact: true }).click();
    await navigation.getByRole('button', { name: 'Training', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
    await navigation.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Log training', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByText('More details', { exact: true }).click();
    await expect(page.getByLabel('Title (optional)', { exact: true })).toHaveValue('Unfinished session');
    await navigation.getByRole('button', { name: 'Todos', exact: true }).click();
    await page.getByLabel('New todo', { exact: true }).fill('Keep this draft');
    await page.getByRole('tab', { name: 'Upcoming', exact: true }).click();
    await page.getByRole('tab', { name: 'Today', exact: true }).click();
    await expect(page.getByLabel('New todo', { exact: true })).toHaveValue('Keep this draft');
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await page.getByRole('tab', { name: 'Today', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Upcoming', exact: true })).toBeFocused();
});


test('exercise-first gym groups sets, repeats values, restores drafts and celebrates confirmed PRs', async ({ page }) => {
    const state = fixture(); state.profile.xp = 9000;
    state.activities.push({ ...state.activities[0]!, id: 'previous-gym', kind: 'gym', title: 'Previous lift', minutes: 0, metres: 0, reward_version: 2 });
    state.sets.push({ id: 'old-set', activity_id: 'previous-gym', exercise_id: 'e', reps: 10, kg: 20, ordinal: 1 });
    state.exercises.push({ id: 'squat', name: 'Barbell squat', bodyweight: false, dumbbell: false });
    await page.clock.setFixedTime(new Date('2026-10-16T08:00:00Z'));
    await mock(page, state); let reject = true; const bodies: { command_id: string; payload: Record<string, unknown> }[] = [];
    await page.route('**/rest/v1/rpc/orion_command', async route => {
        const body = route.request().postDataJSON(); bodies.push(body);
        if (reject) { await route.abort('failed'); return; }
        const reward = { base_xp: 8, pr_xp: 25, strength: 0, records: [{ exercise_id: 'e', exercise_name: 'Incline dumbbell press' }] };
        state.activities.push({ ...state.activities[0]!, id: body.payload.id, kind: 'gym', title: 'gym', minutes: 0, metres: 0, occurred_at: body.payload.occurred_at, reward_version: 2, base_xp: 33, base_points: 0, reward_details: reward });
        state.profile.xp += 33;
        state.events.push({ id: 'new-gym-event', source: `activity:${body.command_id}`, xp: 33, attributes: {}, created_at: body.payload.occurred_at });
        await route.fulfill({ json: { saved: true, personal_record: true, reward } });
    });
    await page.goto('/'); await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await expect(page.getByLabel('Duration (minutes)')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cardio', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
    await expect(page.locator('.gym-picker-list button').first()).toContainText('Incline dumbbell press');
    await page.locator('.gym-picker-list button').first().click();
    const exercise = page.getByRole('group', { name: 'Incline dumbbell press', exact: true });
    await expect(exercise).toContainText('Last session: 10 reps × 20 kg');
    await exercise.getByLabel('Reps', { exact: true }).fill('8'); await exercise.getByLabel('kg', { exact: true }).fill('22.5');
    await exercise.getByRole('button', { name: '+ Set', exact: true }).click();
    await expect(exercise.getByLabel('Reps', { exact: true })).toHaveCount(2);
    await expect(exercise.getByLabel('Reps', { exact: true }).nth(1)).toHaveValue('8');
    await expect(exercise.getByLabel('kg', { exact: true }).nth(1)).toHaveValue('22.5');
    await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
    await page.getByLabel('Search exercises').fill('squat'); await page.locator('.gym-picker-list button').click();
    await page.getByRole('button', { name: 'Remove Barbell squat', exact: true }).click();
    await page.reload(); await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await expect(page.getByLabel('Reps', { exact: true })).toHaveCount(2);
    await page.clock.setFixedTime(new Date('2026-10-16T08:45:00Z'));
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    expect(bodies[0]!.payload.minutes).toBe(0); expect(bodies[0]!.payload.occurred_at).toBe('2026-10-16T08:45:00.000Z');
    expect(bodies[0]!.payload.sets).toEqual([{ exercise_id: 'e', reps: 8, kg: 22.5 }, { exercise_id: 'e', reps: 8, kg: 22.5 }]);
    reject = false; await page.clock.setFixedTime(new Date('2026-10-16T08:50:00Z'));
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    const celebration = page.getByRole('dialog', { name: 'New personal record: Incline dumbbell press', exact: true });
    await expect(celebration).toBeVisible(); await expect(celebration).toContainText('Workout: 8 XP + 25 PR XP');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('running requires actual metrics and uses save time in the profile timezone without opening details', async ({ page }) => {
    const state = fixture(); state.profile.timezone = 'Asia/Kolkata'; state.profile.units = 'imperial';
    await page.clock.setFixedTime(new Date('2026-10-16T08:00:00Z')); await mock(page, state); await page.goto('/');
    await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await page.getByRole('button', { name: 'Running', exact: true }).click();
    await expect(page.getByLabel('Duration (minutes)')).toHaveValue('');
    await expect(page.getByLabel('Distance (mi)')).toHaveValue('');
    await page.getByLabel('Duration (minutes)').fill('25'); await page.getByLabel('Distance (mi)').fill('2');
    await expect(page.locator('.training-details')).not.toHaveAttribute('open', '');
    await page.clock.setFixedTime(new Date('2026-10-16T08:30:00.321Z'));
    const request = page.waitForRequest(r => r.url().endsWith('orion_command'));
    await page.getByRole('button', { name: 'Save activity', exact: true }).click();
    const payload = (await request).postDataJSON().payload;
    expect(payload.occurred_at).toBe('2026-10-16T08:30:00.321Z'); expect(payload.metres).toBeCloseTo(3218.688); expect(payload.minutes).toBe(25);
});

test('gym set controls fit both themes, long exercise names and accessible mobile layouts', async ({ page }) => {
    const state = fixture(); state.exercises[0]!.name = 'Incline dumbbell press with a deliberately long descriptive exercise name';
    await mock(page, state); await page.goto('/'); await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
    await page.locator('.gym-picker-list button').click(); await page.getByRole('button', { name: '+ Set', exact: true }).click();
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            const remove = page.getByRole('button', { name: 'Remove set 1 of ' + state.exercises[0]!.name, exact: true });
            const bounds = await remove.boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
            await page.screenshot({ path: `/tmp/orion-fast-gym-${theme}-${width}.png`, fullPage: true });
        }
    }
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await page.getByRole('button', { name: '+ Set', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByLabel('Reps', { exact: true })).toHaveCount(3);
});


test('correcting an imperial gym workout preserves canonical weights and set order', async ({ page }) => {
    const state = fixture(); state.profile.units = 'imperial';
    state.activities = [{ ...state.activities[0]!, id: 'gym-history', kind: 'gym', title: 'Lift', minutes: 0, metres: 0, reward_version: 2, base_xp: 10, base_points: 0 }];
    state.sets = [{ id: 'second', activity_id: 'gym-history', exercise_id: 'e', reps: 9, kg: 22.456, ordinal: 2 }, { id: 'first', activity_id: 'gym-history', exercise_id: 'e', reps: 8, kg: 20.123, ordinal: 1 }];
    await mock(page, state); await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Training', exact: true }).click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByRole('button', { name: 'Correct entry', exact: true }).click();
    const correction = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Correct activity', exact: true }) });
    await expect(correction.getByLabel('Reps', { exact: true }).first()).toHaveValue('8');
    await expect(correction.getByLabel('Duration (minutes)')).toHaveCount(0);
    const request = page.waitForRequest(r => r.url().endsWith('orion_command'));
    await correction.getByRole('button', { name: 'Save correction', exact: true }).click();
    expect((await request).postDataJSON().payload.sets).toEqual([{ exercise_id: 'e', reps: 8, kg: 20.123 }, { exercise_id: 'e', reps: 9, kg: 22.456 }]);
});


test('exercise popup traps focus, restores its launcher, filters and opens sets without duplicates', async ({ page }) => {
    const state = fixture(); state.exercises.push({ id: 'push-up', name: 'Push-up', bodyweight: true, dumbbell: false });
    await mock(page, state); await page.goto('/'); await page.getByRole('button', { name: 'Log training', exact: true }).click();
    const launcher = page.getByRole('button', { name: '+ Add exercise', exact: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await launcher.click();
    const popup = page.getByRole('dialog', { name: 'Choose an exercise', exact: true });
    await expect(popup).toBeVisible(); await expect(popup.getByLabel('Search exercises')).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await popup.getByRole('button', { name: 'Back to workout', exact: true }).focus(); await page.keyboard.press('Tab');
    await expect(popup.getByRole('button', { name: 'Close exercise chooser', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(popup.getByRole('button', { name: 'Back to workout', exact: true })).toBeFocused();
    await popup.getByLabel('Search exercises').fill('no matching exercise');
    await expect(popup.getByRole('heading', { name: 'No exercises found' })).toBeVisible();
    await popup.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(popup.getByLabel('Search exercises')).toHaveValue('');
    await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0); await expect(launcher).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await launcher.click(); await popup.getByLabel('Search exercises').fill('push');
    await popup.getByRole('button', { name: /Push-up/ }).click();
    await expect(popup).toHaveCount(0); await expect(page.getByLabel('Reps', { exact: true })).toBeFocused();
    await launcher.click(); await expect(popup.getByRole('button', { name: /Push-up/ })).toContainText('In workout');
    await popup.getByRole('button', { name: /Push-up/ }).click();
    await expect(page.getByLabel('Reps', { exact: true })).toHaveCount(1);
    await launcher.click(); await page.mouse.click(2, 2); await expect(popup).toHaveCount(0); await expect(launcher).toBeFocused();
});

test('exercise popup fits both themes and small screens with long names, reduced motion and forced colors', async ({ page }) => {
    const state = fixture(); state.exercises[0]!.name = 'Incline dumbbell press with a deliberately long descriptive exercise name';
    for (let i = 0; i < 12; i++) state.exercises.push({ id: `lift-${i}`, name: `Exercise ${i}`, bodyweight: i % 2 === 0, dumbbell: false });
    await mock(page, state); await page.goto('/'); await page.getByRole('button', { name: 'Log training', exact: true }).click();
    await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Choose an exercise', exact: true });
    for (const theme of ['dark', 'light']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        for (const width of [320, 390, 768, 1440]) {
            const height = width === 320 ? 568 : 900;
            await page.setViewportSize({ width, height });
            const bounds = await popup.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
            expect(await popup.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect(await popup.locator('.exercise-picker-choice').evaluateAll(rows => rows.every(row => row.scrollHeight <= row.clientHeight))).toBe(true);
            await expect(popup.getByRole('button', { name: 'Back to workout', exact: true })).toBeVisible();
            await page.screenshot({ path: `/tmp/orion-exercise-popup-${theme}-${width}.png` });
        }
    }
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    expect(await popup.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await popup.getByLabel('Search exercises').fill('incline');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await expect(popup).toHaveCount(0); await expect(page.getByLabel('Reps', { exact: true })).toBeFocused();
});

function customBoss(id = 'custom-boss', title = 'The stone wall'): Boss {
    return { id, title, template_id: '', hours: 168, period: 'weekly', avatar: 'guardian', description: 'A challenge worth finishing.',
        attributes: ['Strength', 'Discipline'], objectives: [], requirements: [
            { id: 'prepare', title: 'Prepare your kit', metric: 'checklist', target: 1, progress: 0, failed: false },
            { id: 'count', title: 'Practice sessions', metric: 'manual', target: 4, progress: 0, failed: false },
        ], remaining_health: 100, victory_xp: 1000, failure_xp: 250, victory_points: 15, failure_points: 5,
        accepted_at: new Date(Date.now()-1000).toISOString(), deadline: new Date(Date.now()+86400000*7).toISOString(), resolved_at: null, status: 'active' };
}
test('custom boss creation preserves drafts, avatars, frozen acceptance and retry IDs', async ({ page }) => {
    const state=fixture(); await mock(page,state); const calls: {command_id:string; action:string; payload:Record<string,unknown>}[]=[]; let uncertain=true;
    await page.route('**/rest/v1/rpc/orion_command', async route=>{
        const body=route.request().postDataJSON(); calls.push(body);
        if(uncertain){await route.abort('failed');return;}
        const p=body.payload;
        state.bosses.push({...customBoss(p.id,p.title),period:p.period,avatar:p.avatar,attributes:p.attributes,
            requirements:p.requirements.map((r:BossRequirement,i:number)=>({...r,id:`req-${i}`,progress:0,failed:false}))});
        await route.fulfill({json:{saved:true}});
    });
    await page.goto('/'); await page.getByRole('navigation').getByRole('button',{name:'Bosses',exact:true}).click();
    const launcher=page.getByRole('button',{name:'Create boss',exact:true}); await launcher.click();
    let dialog=page.getByRole('dialog',{name:'Create boss',exact:true});
    await dialog.getByLabel('Boss name',{exact:true}).fill('Defeat the backlog');
    await dialog.getByRole('radio',{name:'Spectral creature',exact:true}).check();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
    await launcher.click(); dialog=page.getByRole('dialog',{name:'Create boss',exact:true});
    await expect(dialog.getByLabel('Boss name',{exact:true})).toHaveValue('Defeat the backlog');
    await expect(dialog.getByRole('radio',{name:'Spectral creature',exact:true})).toBeChecked();
    await dialog.getByRole('combobox',{name:'Period',exact:true}).selectOption('monthly');
    await dialog.getByRole('checkbox',{name:'Intellect',exact:true}).check();
    await dialog.getByLabel('Requirement title',{exact:true}).fill('Clear the desk');
    await dialog.getByRole('button',{name:'Add requirement',exact:true}).click();
    let rows=dialog.locator('.objective-draft');
    await rows.nth(1).getByLabel('Progress from').selectOption('manual'); await rows.nth(1).getByLabel('Requirement title').fill('Practice'); await rows.nth(1).getByLabel('Target').fill('3');
    await dialog.getByRole('button',{name:'Add requirement',exact:true}).click();
    await rows.nth(2).getByLabel('Progress from').selectOption('minutes'); await rows.nth(2).getByLabel('Requirement title').fill('Read'); await rows.nth(2).getByLabel('Target').fill('30'); await rows.nth(2).getByLabel('Activity filter').selectOption('reading');
    await dialog.getByRole('button',{name:'Add requirement',exact:true}).click();
    await rows.nth(3).getByLabel('Progress from').selectOption('quest'); await rows.nth(3).getByRole('combobox',{name:'Active quest',exact:true}).selectOption('q');
    await dialog.getByRole('button',{name:'Review acceptance',exact:true}).click();
    await expect(dialog.locator('.boss-acceptance')).toContainText('Victory: +3,000 XP, +30 in each of Discipline and Intellect.');
    await expect(dialog.locator('.boss-acceptance')).toContainText('Failure: −750 XP, −10');
    expect(calls.length).toBe(0);
    await dialog.getByRole('button',{name:'Accept boss and penalties',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Retry save',exact:true})).toBeVisible();
    uncertain=false; await dialog.getByRole('button',{name:'Retry save',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Boss accepted',exact:true})).toBeVisible();
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]!.payload).toMatchObject({accepted:true,avatar:'spectral',period:'monthly',attributes:['Discipline','Intellect']});
    await page.getByRole('button',{name:'View bosses',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Defeat the backlog',exact:true})).toBeVisible();
});
test('multiple boss dossiers use confirmed HP, manual corrections and named victory feedback',async({page})=>{
 const state=fixture(); state.bosses=[customBoss(),customBoss('second','The second gate')]; await mock(page,state);
 await page.route('**/rest/v1/rpc/orion_command',async route=>{
  const p=route.request().postDataJSON().payload; const b=state.bosses.find(b=>b.id===p.id)!; const r=b.requirements!.find(r=>r.id===p.requirement_id)!; r.progress=p.progress;
  b.remaining_health=100*(1-b.requirements!.reduce((n,r)=>n+r.progress/r.target,0)/b.requirements!.length);
  if(b.remaining_health===0){b.status='victory';b.resolved_at=new Date().toISOString();state.profile.xp+=1000;state.events.push({id:'boss-result',source:`boss:${b.id}`,xp:1000,attributes:{Strength:15,Discipline:15},created_at:b.resolved_at});}
  await route.fulfill({json:{saved:true}});
 });
 await page.goto('/'); await expect(page.locator('.dashboard-boss-entry')).toHaveCount(2);
 await page.locator('.dashboard-boss-entry').nth(1).getByRole('button',{name:'View encounter',exact:true}).click();
 let detail=page.getByRole('region',{name:'Boss details',exact:true}); await expect(detail).toBeFocused(); await expect(detail.getByRole('heading',{name:'The second gate',exact:true})).toBeVisible();
 await expect(detail.getByText('100 / 100 HP',{exact:true})).toBeVisible();
 const checkbox=detail.getByRole('checkbox',{name:'Complete Prepare your kit',exact:true});
 await checkbox.click(); await expect(detail.getByText('50 / 100 HP',{exact:true})).toBeVisible();
 await detail.getByLabel('Count for Practice sessions').fill('2'); await detail.getByRole('button',{name:'Save count',exact:true}).click(); await expect(detail.getByText('25 / 100 HP',{exact:true})).toBeVisible();
 await checkbox.click(); await expect(detail.getByText('75 / 100 HP',{exact:true})).toBeVisible();
 await detail.getByLabel('Count for Practice sessions').fill('4'); await detail.getByRole('button',{name:'Save count',exact:true}).click(); await checkbox.click();
 await expect(page.getByRole('dialog')).toContainText('Victory: The second gate'); await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('combobox',{name:'Encounters',exact:true}).selectOption('history'); detail=page.getByRole('region',{name:'Boss details',exact:true});
 await expect(detail.getByText('0 / 100 HP',{exact:true})).toBeVisible(); await expect(detail.getByRole('button',{name:'Save count',exact:true})).toHaveCount(0);
 await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('boss dossier and avatar popup fit both themes with long names and accessible controls',async({page})=>{
 const state=fixture(); state.bosses=[customBoss('long','The guardian '+ 'of a very long encounter '.repeat(4))]; await mock(page,state); await page.goto('/');
 await page.getByRole('navigation').getByRole('button',{name:'Bosses',exact:true}).click();
 for(const theme of ['dark','light']){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`/tmp/orion-boss-${theme}-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'Create boss',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'Create boss',exact:true}); await expect(dialog).toBeVisible();
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   await page.screenshot({path:`/tmp/orion-boss-forge-${theme}-${width}.png`,fullPage:true});
   await page.keyboard.press('Escape');
  }
 }
 await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});
 await page.getByRole('button',{name:'Create boss',exact:true}).click(); const dialog=page.getByRole('dialog',{name:'Create boss',exact:true});
 const avatar=dialog.getByRole('radio',{name:'Armored knight',exact:true}); await avatar.focus(); await page.keyboard.press('Space'); await expect(avatar).toBeChecked();
 await page.screenshot({path:'/tmp/orion-boss-forced-colors.png',fullPage:true});
 await page.keyboard.press('Escape'); const check=page.getByRole('checkbox',{name:'Complete Prepare your kit',exact:true}); await check.focus(); await expect(check).toBeFocused();
});

test('activity finishes a boss and linked quest once, and completed links open their own quest details',async({page})=>{
 const state=fixture(); const q=state.quests[0]!; q.period='one-off';q.timeline='weekly';q.title='Finish the chapter';q.metric='manual';q.target=1;q.progress=0;q.status='active';q.objectives=[{id:'read-objective',title:'Read 30 minutes',ordinal:1,metric:'minutes',target:30,progress:0,activity_kind:'reading',attribute:'Intellect'}];
 const b=customBoss('final','The final chapter');b.requirements=[{id:'activity',title:'Read for the boss',metric:'minutes',target:30,progress:0,activity_kind:'reading',failed:false},{id:'link',title:'Finish the linked quest',metric:'quest',target:1,progress:0,quest_id:q.id,failed:false}];state.bosses=[b];await mock(page,state);
 await page.route('**/rest/v1/rpc/orion_command',async route=>{
  const body=route.request().postDataJSON();expect(body.action).toBe('activity');
  q.status='completed';q.completed_at=new Date().toISOString();q.progress=1;q.objectives![0]!.progress=30;b.requirements![0]!.progress=30;b.requirements![1]!.progress=1;b.remaining_health=0;b.status='victory';b.resolved_at=q.completed_at;
  state.profile.xp+=1025;state.events.push({id:'quest-result',source:`quest:${q.id}`,xp:25,attributes:{Intellect:1},created_at:q.completed_at},{id:'encounter-result',source:`boss:${b.id}`,xp:1000,attributes:{Strength:15},created_at:q.completed_at});
  await route.fulfill({json:{saved:true}});
 });
 await page.goto('/');await page.getByRole('button',{name:'View encounter',exact:true}).click();await expect(page.getByText('100 / 100 HP',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open linked quest',exact:true}).click();await expect(page.getByRole('region',{name:'Quest details',exact:true})).toContainText('Finish the chapter');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Journal',exact:true}).click();
 await page.getByLabel('Duration (minutes)',{exact:true}).fill('30');await page.getByRole('button',{name:'Save activity',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Victory: The final chapter');await expect(page.getByRole('dialog')).toContainText('Quest complete: Finish the chapter');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Bosses',exact:true}).click();await page.getByRole('combobox',{name:'Encounters',exact:true}).selectOption('history');
 await expect(page.getByText('0 / 100 HP',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Open linked quest',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Quest status',exact:true})).toHaveValue('completed');await expect(page.getByRole('region',{name:'Quest details',exact:true})).toContainText('Finish the chapter');
});
test('abandoning a boss confirms failure, retains history, and cooldown leaves other encounters usable',async({page})=>{
 const state=fixture();state.bosses=[customBoss('fail','The abandoned gate'),customBoss('keep','Keep fighting')];await mock(page,state);
 await page.route('**/rest/v1/rpc/orion_command',async route=>{
  const body=route.request().postDataJSON();expect(body.action).toBe('abandon_boss');const b=state.bosses.find(b=>b.id===body.payload.id)!;b.status='failure';b.resolved_at=new Date().toISOString();state.profile.xp-=250;state.events.push({id:'failure',source:`boss:${b.id}`,xp:-250,attributes:{Strength:-5},created_at:b.resolved_at});await route.fulfill({json:{saved:true}});
 });
 await page.goto('/');await page.locator('.dashboard-boss-entry').first().getByRole('button',{name:'View encounter',exact:true}).click();await page.getByRole('button',{name:'Abandon boss',exact:true}).click();
 await expect(page.getByText('Abandoning applies the failure penalty immediately and starts a 24-hour cooldown. Other active bosses continue.')).toBeVisible();
 await page.getByRole('button',{name:'Accept failure and abandon',exact:true}).click();
 await expect(page.getByRole('button',{name:'Create boss',exact:true})).toBeDisabled();await expect(page.getByRole('region',{name:'Boss details',exact:true})).toContainText('Keep fighting');
 await expect(page.getByRole('checkbox',{name:'Complete Prepare your kit',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Encounters',exact:true}).selectOption('history');
 await expect(page.getByRole('region',{name:'Boss details',exact:true})).toContainText('The abandoned gate');await expect(page.getByRole('button',{name:'Abandon boss',exact:true})).toHaveCount(0);
});
