# Orion

A private life-tracking RPG built with React, TypeScript, Vite, plain CSS, and
Supabase. Log training, reading, study, focus, social time, habits, and recovery.
Grow six attributes, complete recurring quests, and optionally accept boss
missions with explicit rewards and penalties. New players start in dark mode
with every attribute at 10. Light mode is available in Settings.

## Development

Use Node 22.12+ and the pinned pnpm 11.28.5.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set the public Supabase URL and anonymous/publishable key.
pnpm dev
```

Without environment configuration, the app displays setup instructions. It does
not silently create a local game or pretend that data is synchronized. Only the
public project key belongs in Vite environment variables. Never expose a
service-role key, database password, or SMTP credentials.

## Database and authentication setup

Create a Supabase project, or use the Supabase CLI with Docker:

```sh
supabase start
supabase db reset
```

For a hosted project, link the CLI and apply the checked-in migrations:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively, execute the SQL migrations in filename order using Supabase’s SQL
editor. The first creates tables, catalogs, RLS, commands, snapshots, and reward
settlement. The second enables `pg_cron` and schedules boss expiry every minute.
The seed file deliberately contains no accounts or private data; exercise and
boss catalogs are versioned with the schema. Apply each migration once.

In Supabase Auth, enable email/password signup and **email confirmation**, set
the Site URL to the frontend origin, and allow that exact URL as a redirect for
confirmation and password reset. Local development defaults to
`http://localhost:5173`. Configure production SMTP/email delivery before opening
public signup. Test signup, confirmation, sign-in, reset links, new passwords,
and sign-out on the deployed origin. See the official
[password authentication documentation](https://supabase.com/docs/guides/auth/passwords).

Confirm the cron job exists and is running:

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'orion-boss-expiry';
select * from cron.job_run_details order by start_time desc limit 10;
```

Snapshots and writes also settle expired bosses, but the cron job is required
for settlement while the app is closed. See [Supabase Cron](https://supabase.com/docs/guides/cron).

## Data and progression

Player-owned records cover profiles, activities, exercise definitions, completed
workout sets, habits, quest definitions and instances, boss attempts, command
receipts, and progression events. Gym activities are workout sessions; their sets
reference the session’s activity ID. Habits and recovery completions are dated
activity records, preserving daily history.

Authenticated clients can read only their own records and the shared catalogs.
They cannot write tables directly. `orion_command` validates and applies changes
in one transaction; `orion_snapshot` returns confirmed data. Internal helpers
are inaccessible to API roles. Commands, snapshots, and cron settlement lock the
same profile row. Command IDs and unique reward-source keys protect retries.
These controls follow Supabase’s [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [database function](https://supabase.com/docs/guides/database/functions) guidance.

- Activities grant 10 XP per completed 10 minutes (maximum 60), and one relevant
  attribute point per completed 30 minutes (maximum three).
- Habits grant 5 XP and one Discipline point per habit/day. Recovery targets
  grant 10 XP and one Vitality point per target/day.
- Cumulative XP thresholds are `floor(100 * (level - 1)^1.5)`. Ranks are E at
  levels 1–9, D at 10–24, C at 25–39, B at 40–59, A at 60–79, and S at 80+.
- Daily todos are simple manual checkboxes: title, optional attribute, planned date
  (today by default), medium difficulty by default, and optional deadline.
  Unfinished todos carry forward. Upcoming and history views keep other days accessible.
  Easy/medium/hard todos award 15/25/50 XP and optionally +1 selected attribute.
  Late completion deducts 25% XP rounded up and grants no attribute reward;
  it instead deducts one selected attribute point. A medium late todo earns
  18 XP/−1 attribute. Without an attribute, only XP changes. Passing the deadline
  alone has no effect. Unchecking reverses the recorded actual outcome and
  rechecking uses the new server completion time.
- Todo terms can be edited while open and before the deadline; afterward only
  title corrections and archiving are allowed. Saved deadlines are UTC instants
  entered/displayed in the profile timezone. Planned dates do not impose deadlines.
- Recurring quests and existing one-off quests keep their original rules and
  rewards. Automatic quests use existing activity metrics; todos never auto-complete.
- Medium daily/weekly/monthly rewards remain 25/100/300 XP and 1/3/8 attribute
  points. One-off rewards match daily rewards. Easy rewards are 15/50/150 XP and
  1/2/4 points; hard rewards are 50/200/600 XP and 2/6/16 points.
- Existing one-off quest deadlines are entered in the profile timezone and stored as UTC
  instants, unchanged by later timezone changes. Deadlines must be in the future.
  Completion at or after the deadline grants the reward, then deducts 25% of its
  XP (rounded up) and one selected attribute point. An existing medium late one-off quest nets
  18 XP and zero attribute points. Merely becoming overdue never deducts rewards.
- Existing undated one-off quests stay open; dated quests stay actionable when overdue.
  Archiving closes a one-off without rewards. One-off terms are fixed, with title
  corrections allowed. Recurring edits affect future instances only. Rewards and
  penalties are stored on instances and included in completion history and exports.
- Automatic one-off progress requires activity performed and recorded after task
  creation. Imported activity is excluded. Calendar recurrence uses the profile
  timezone, Monday-start weeks, and no carryover or missed-period penalties.
  Automatic metrics count activities in the selected attribute. Weeks begin
  Monday, and periods follow the player’s timezone. Instances preserve history
  and fixed boundaries. Edits affect future instances; archiving stops recurrence.
- Bosses are optional. A 24-hour victory grants 250 XP/+5 to each named
  attribute; failure deducts 75 XP/2 from each. A seven-day victory grants
  1,000 XP/+15 each; failure deducts 250 XP/5 each. Abandoning is failure. XP
  floors at zero and attributes at one; displayed level/rank always follow XP.
- Only activities both performed and recorded within `[accepted_at, deadline)`
  count for bosses. Outcomes are final. One active boss, one attempt per template
  per calendar period, and a 24-hour cooldown after failure are enforced on the
  server. Rewards, penalties, and fixed objectives appear before acceptance.

Weights persist in kg, distances in metres. Imperial display converts on entry
and presentation. Dumbbell weight is **per dumbbell**, with both dumbbells
counted in volume. Bodyweight exercises use added weight; body mass is not
invented. Attribute scores represent game progression, not physical assessments.

Activity corrections reconcile base rewards. Settled quest and boss rewards
never reopen. Imported workouts carry no base reward and cannot advance quests
or bosses. Import is a one-time, explicit trust boundary for self-reported legacy
XP: old browser saves cannot be cryptographically verified. Original raw history
and achievements remain available in the account export; historical sets are
never invented. The original browser save is not removed.

## Connection behavior and account data

Orion is online first. Training/journal drafts persist locally, scoped by account
and units. An uncertain save retains its command ID across reloads; use **Retry
save**. Confirmed server rejections roll back and leave the draft editable. A
failed refresh after a successful mutation reports that the save succeeded.
Snapshots refresh after saves, navigation, focus, and every minute. Confirmed
rewards are presented in one visual/audio queue. Ordinary completions show brief
XP and attribute gains. Levels, rank promotions, personal records, and boss
victories share a milestone dialog; Continue or Escape dismisses it and returns
focus to the originating control. Initial loads and retries never replay rewards.
Background updates produce a silent recap instead of a modal.

The cosmic HUD, attribute sigils, rank emblems, and objective crests are native
SVG/CSS. All reward values come from confirmed profile changes, including floors;
this presentation adds no gameplay rules or database migrations. Losses and late
completion use restrained feedback rather than victory effects.

Sound stays off until enabled in the HUD or Settings. Settings provides a preview,
volume (40% by default), and Full/Reduced/Off visual effects. These preferences
persist on this device. Reduced motion from the operating system overrides Full.
Sound effects are synthesized with Web Audio; there are no audio downloads,
background music, or ambience. Muting or dismissing a presentation stops active
voices and queued cues; unmuting does not replay them. Browsers without Web Audio
still show all visual feedback.

Settings includes JSON account export and permanent deletion with a typed
confirmation. Deletion cascades through private server records and clears this
device’s Orion drafts/pending requests. Other devices’ local drafts and the
original legacy browser save are not remotely erasable. Sign-out leaves drafts
scoped to their account for later resumption.

## Validation

```sh
pnpm lint
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Node tests cover units, pace, thresholds, rank changes, reward caps, and legacy
validation. PGlite runs the production SQL migration on a PostgreSQL engine to
test RLS isolation, rejected writes, atomic rollback, idempotency, corrections,
quest rewards, timezone boundaries, PRs, imports, deletion, boss floors, both
mission lengths, and activity immediately before/at/after an exclusive deadline.

PGlite has one backend connection. A separate test uses a real PostgreSQL pool
to verify simultaneous submissions and concurrent cron settlement. It is skipped
unless an isolated migrated local database is provided:

```sh
ORION_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test
```

That test creates and removes a disposable Auth user and needs an administrative
database connection. **Never run it against production.**

Playwright uses mocked Auth sessions and Supabase responses, without a runtime
demo mode or authentication bypass. It checks all six screens in dark/light at
320, 390, 768, and 1440px, drafts, canonical set payloads, retry IDs, rejection
recovery, boss acceptance, onboarding, keyboard use, and reduced motion. These
tests do not prove hosted email delivery, cron scheduling, or cross-device Auth.

Before production release, use two real accounts to verify confirmation and
reset emails; private record isolation; progress after switching device/browser;
account export/deletion; a failed connection and retry; boss expiration with the
app closed; and successful cron job runs. Keep signup closed until this review
is complete.

## Deployment and review

Deploy the Vite `dist/` output to static hosting. Build command: `pnpm build`.
Set the two public Vite environment variables **before building**; they are
embedded at build time. Serve over HTTPS. Set Supabase Site URL and allowed
redirect URLs to the production origin, configure email delivery, apply both
migrations, and verify cron before public signup. No secret key is needed in the
frontend deployment. The app uses one document and has no route rewrite needs.

The complete implementation is consolidated on `feature/orion-final` in one pull
request against `master`. Review and merge that PR; the earlier stacked PRs are
superseded. It includes the transactional database contract, tracking, quests,
bosses, interface, analytics, and completion sound effects. Do not deploy without
review. Production credentials, hosting, and live-account verification are
deployment responsibilities.

GPS, wearables, multiplayer, inventory, public leaderboards, and offline
synchronization are outside this release. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [AGENTS.md](AGENTS.md) for repository conventions.

### User-defined task migration

Apply `supabase/migrations/202610160001_tasks.sql` after the existing migrations
before deploying this client. It adds task scheduling and frozen reward terms,
replaces the quest sync and authenticated command functions, and preserves existing
quest IDs, boundaries, progress, completions, and awards as medium difficulty.
The snapshot/export functions already serialize complete table rows, so the new
fields are included automatically. No backfill awards or late penalties are run
for historical completions. Verify task creation, late completion, and export on
an isolated migrated database before deploying to a live account.

Daily habit and recovery buttons can be unchecked for the current profile day.
Unchecking removes that activity and reverses its base XP/attribute reward;
checking again restores it without stacking rewards. Open quest progress follows
the current records; already settled quest and boss outcomes stay final. Apply
`supabase/migrations/202610160002_daily_toggles.sql` before deploying the updated
client. Recovery completions use the queued completion chime when sounds are on.

### Daily todo migration

Apply `supabase/migrations/202610160003_todos.sql` after all prior migrations,
including `202610160002_daily_toggles.sql`, before deploying the client. It adds a
quest/todo distinction, optional todo attributes, planned dates, and completion
cycle history to existing quest storage. Existing records remain quests with
unchanged IDs, boundaries, progress, completions, and reward events. Snapshot and
export rows include todo fields and historical applied outcomes. No cron change
is required: lateness is evaluated only when completing a todo. Run concurrency
tests only with `ORION_TEST_DATABASE_URL` pointing at an isolated migrated database.
