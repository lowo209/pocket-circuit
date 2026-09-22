import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { PeerServer } from 'peer';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This test uses a local signaling broker. Gameplay still travels over real WebRTC.
const publicBroker = process.env.TEST_PUBLIC_PEER === '1';
if (!publicBroker) {
  process.env.VITE_PEER_HOST = 'localhost';
  process.env.VITE_PEER_PORT = '9010';
  process.env.VITE_PEER_PATH = '/';
  process.env.VITE_PEER_SECURE = 'false';
}
const artifacts = new URL('../test-results/browser/', import.meta.url);
await mkdir(artifacts, { recursive: true });
let broker;
if (!publicBroker)
  await new Promise((resolve) => {
    PeerServer({ port: 9010, path: '/' }, (server) => {
      broker = server;
      resolve();
    });
  });
const server = await createServer({ server: { port: 5183, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  channel: process.env.PW_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const contexts = [];
const errors = [];
async function open(width = 1440, height = 1000) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 600,
    isMobile: width < 600,
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5183/');
  await page.getByRole('button', { name: 'Auf die Strecke', exact: true }).waitFor();
  return page;
}
async function shot(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name, artifacts)), fullPage: true });
}
try {
  const host = await open();
  await host.waitForTimeout(1500);
  await shot(host, 'home.png');
  assert.equal(await host.locator('canvas').count(), 1);
  assert.equal(await host.locator('.webgl-error').count(), 0);
  await host.getByRole('button', { name: 'Steuerung', exact: true }).click();
  await host.getByRole('button', { name: 'Alles klar' }).click();
  await host.getByRole('button', { name: /Dust Valley/ }).click();
  assert.equal(await host.locator('.scene-track b').innerText(), 'Dust Valley');
  await host.getByRole('button', { name: /Neon Harbor/ }).click();
  await host.waitForTimeout(500);
  await shot(host, 'neon.png');
  await host.getByRole('button', { name: /Sunset Bay/ }).click();
  await host.getByRole('button', { name: 'Garage', exact: true }).click();
  await host.getByRole('button', { name: /Coral Club/ }).click();
  await shot(host, 'garage.png');
  assert.equal(await host.getByRole('button', { name: 'Noch Münzen sammeln' }).isDisabled(), true);
  await host.getByRole('button', { name: 'Rennen', exact: true }).click();
  await host.getByRole('button', { name: 'Auf die Strecke', exact: true }).click();
  await host.waitForTimeout(3500);
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(2200);
  await host.keyboard.up('KeyW');
  assert.ok(
    Number(await host.locator('.speedometer>strong').innerText()) > 0,
    'solo keyboard accelerates',
  );
  await shot(host, 'race.png');
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: 'Rennen verlassen', exact: true }).click();
  const saved = await host.evaluate(() =>
    JSON.parse(localStorage.getItem('pocket-circuit.profile.v1')),
  );
  assert.equal(saved.races, 0, 'aborted race gives no reward');
  await host.getByLabel('Fahrername').fill('Host Racer');
  await host.getByRole('button', { name: 'Mit Freunden', exact: true }).click();
  await host.getByRole('button', { name: 'Raum erstellen', exact: true }).click();
  await host.locator('.room-heading strong').waitFor({ timeout: 25000 });
  const code = await host.locator('.room-heading strong').innerText();
  assert.match(code, /^[A-Z2-9]{6}$/);
  const guest = await open();
  await guest.getByLabel('Fahrername').fill('Guest Racer');
  await guest.getByRole('button', { name: 'Mit Freunden', exact: true }).click();
  await guest.getByLabel('Raumcode', { exact: true }).fill(code);
  await guest.getByRole('button', { name: 'Raum beitreten', exact: true }).click();
  await guest
    .getByRole('button', { name: 'Ich bin bereit', exact: true })
    .waitFor({ timeout: 25000 });
  await guest.getByRole('button', { name: 'Ich bin bereit', exact: true }).click();
  await host.getByRole('button', { name: 'Rennen starten', exact: true }).waitFor();
  await host.getByRole('button', { name: /Dust Valley/ }).click();
  await guest.getByRole('button', { name: 'Ich bin bereit', exact: true }).waitFor();
  await guest.getByRole('button', { name: 'Ich bin bereit', exact: true }).click();
  await host.getByRole('button', { name: 'Rennen starten', exact: true }).click();
  await guest.locator('.race-top').waitFor({ timeout: 10000 });
  await guest.waitForTimeout(3500);
  assert.ok((await guest.locator('.live-rank').innerText()).includes('Host Racer'));
  assert.ok((await host.locator('.live-rank').innerText()).includes('Guest Racer'));
  await guest.keyboard.down('KeyW');
  await guest.waitForTimeout(2000);
  await guest.keyboard.up('KeyW');
  assert.ok(
    Number(await guest.locator('.speedometer>strong').innerText()) > 0,
    'guest input reaches host simulation and returns',
  );
  await shot(guest, 'multiplayer.png');
  const late = await open();
  await late.getByRole('button', { name: 'Mit Freunden', exact: true }).click();
  await late.getByLabel('Raumcode', { exact: true }).fill(code);
  await late.getByRole('button', { name: 'Raum beitreten', exact: true }).click();
  await late.getByRole('status').waitFor({ timeout: 25000 });
  assert.match(await late.getByRole('status').innerText(), /läuft|gestartet|Rennen/);
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: 'Rennen verlassen', exact: true }).click();
  await guest
    .getByRole('button', { name: 'Raum erstellen', exact: true })
    .waitFor({ timeout: 15000 });
  await Promise.all([host.context().close(), guest.context().close(), late.context().close()]);
  const mobile = await open(390, 844);
  await shot(mobile, 'mobile.png');
  assert.ok(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'no mobile horizontal overflow',
  );
  await mobile.getByRole('button', { name: 'Karriere', exact: true }).click();
  await shot(mobile, 'mobile-career.png');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.getByRole('button', { name: 'Rennen', exact: true }).click();
  await mobile.getByRole('button', { name: 'Auf die Strecke', exact: true }).click();
  await mobile.locator('.race-top').waitFor();
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.waitForTimeout(3500);
  const gas = mobile.getByRole('button', { name: 'Gas geben', exact: true });
  await gas.hover();
  await mobile.mouse.down();
  await mobile.waitForTimeout(1700);
  await mobile.mouse.up();
  assert.ok(
    Number(await mobile.locator('.speedometer>strong').innerText()) > 0,
    'touch gas button accelerates',
  );
  await shot(mobile, 'mobile-race.png');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'three themes',
        'garage preview and locked purchase',
        'solo keyboard driving',
        'abort gives no reward',
        'real WebRTC lobby',
        'ready reset on track change',
        'host race start',
        'guest driving round trip',
        'late join rejection',
        'host disconnect',
        'mobile layout',
        'mobile gas control',
      ],
      artifacts: artifacts.pathname,
    }),
  );
} catch (error) {
  for (const [i, context] of contexts.entries()) {
    for (const page of context.pages()) {
      if (!page.isClosed()) await shot(page, `failure-${i}.png`).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
  broker?.close();
  broker?.closeAllConnections?.();
}
// PeerServer owns housekeeping timers which otherwise keep this test process alive.
process.exit(0);
