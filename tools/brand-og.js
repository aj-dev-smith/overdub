// Renders the landing page's social card: site/assets/og-card.html -> site/assets/og.png (1200x630).
//   node tools/brand-og.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { page, errors, close } = await open('/site/assets/og-card.html', { width: 1200, height: 630 });
await page.waitForFunction(() => window.__ogReady === true, null, { timeout: 15000 });
await page.waitForTimeout(300);
const out = path.join(ROOT, 'site/assets/og.png');
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await close();
if (errors.length) { console.log('errors:', errors); process.exitCode = 1; } else console.log('wrote', path.relative(ROOT, out));
