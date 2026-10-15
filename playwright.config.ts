import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/browser', fullyParallel: false,
    use: { baseURL: 'http://127.0.0.1:5174', headless: true },
    webServer: {
        command: 'pnpm dev --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
        env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'orion-browser-test-public-key' },
    },
});
