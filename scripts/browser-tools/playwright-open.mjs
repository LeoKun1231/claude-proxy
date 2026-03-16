import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const profileDir = process.env.PLAYWRIGHT_PROFILE_DIR || path.join(rootDir, '.browser-tools', 'playwright-profile');
const targetUrl = process.argv[2] || 'http://127.0.0.1:5173';
const headless = process.env.PLAYWRIGHT_HEADLESS === '1';
const channel = process.env.PLAYWRIGHT_CHANNEL || 'chrome';

const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless,
    viewport: { width: 1440, height: 900 },
});

const page = context.pages()[0] ?? await context.newPage();
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

console.log(`Playwright opened ${targetUrl}`);
console.log(`Profile: ${profileDir}`);

if (headless) {
    await context.close();
    process.exit(0);
}

const browser = context.browser();
if (browser) {
    await new Promise((resolve) => {
        browser.on('disconnected', resolve);
    });
}
