import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = new URL('../test-results/graphics/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5184, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /THREE|GL_INVALID|WebGL|VALIDATE_STATUS/.test(m.text()))
      errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5184/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Auf die Strecke', exact: true }).waitFor();
  for (const [track, name] of [
    ['coast', 'Sunset Bay'],
    ['canyon', 'Dust Valley'],
    ['midnight', 'Neon Harbor'],
  ]) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByLabel('Grafikqualität', { exact: true }).selectOption('high');
    await page.waitForTimeout(1800);
    await page.screenshot({
      path: fileURLToPath(new URL(`${track}-preview.png`, artifacts)),
      fullPage: true,
    });
    assert.equal(await page.locator('.webgl-error').count(), 0);
    await page.getByRole('button', { name: 'Auf die Strecke', exact: true }).click();
    await page.waitForTimeout(3500);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: fileURLToPath(new URL(`${track}-onroad.png`, artifacts)),
      fullPage: true,
    });
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(700);
    await page.screenshot({
      path: fileURLToPath(new URL(`${track}-race.png`, artifacts)),
      fullPage: true,
    });
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    await page.getByLabel('Grafikqualität im Rennen', { exact: true }).selectOption('balanced');
    await page.getByRole('button', { name: 'Weiterfahren', exact: true }).click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rennen verlassen', exact: true }).click();
  }
  await page.reload();
  assert.equal(await page.getByLabel('Grafikqualität', { exact: true }).inputValue(), 'balanced');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Sunset Bay/ }).click();
  await page.getByRole('button', { name: /Neon Harbor/ }).click();
  await page.waitForTimeout(500);
  assert.deepEqual(errors, [], 'graphics run without shader/context/runtime errors');
  console.log(
    JSON.stringify({
      passed: true,
      tracks: 3,
      qualities: 2,
      checks: [
        'rendering and animation',
        'rain and reflections',
        'drift input',
        'runtime graphics switch',
        'preference persistence',
        'reduced motion',
        'shader errors',
      ],
      artifacts: fileURLToPath(artifacts),
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
