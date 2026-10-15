-- Supabase includes pg_cron. Keep scheduling separate for local PostgreSQL tests.
create extension if not exists pg_cron;
select cron.schedule('orion-boss-expiry', '* * * * *', 'select public.orion_expire_bosses()');
