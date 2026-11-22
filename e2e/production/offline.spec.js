import { test as base, expect } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareSite } from '../../scripts/prepare-site.mjs';
import { createFixtureServer } from './server.mjs';

const productionDir = fileURLToPath(new URL('../../dist/', import.meta.url));
const FOREIGN_CACHES = ['unrelated-app-cache', 'little-sky:/another-app/:keep'];

const test = base.extend({
  site: async ({}, use) => {
    const distDir = await mkdtemp(path.join(tmpdir(), 'little-sky-production-'));
    let server;
    try {
      await cp(productionDir, distDir, { recursive: true });
      await writeFile(path.join(distDir, 'fixture-host.html'), '<!doctype html><title>Same-origin cache fixture</title>');
      // A separately offered standalone download must never enter the app's
      // immutable offline cache, even when it exists during preparation.
      await writeFile(path.join(distDir, 'little-sky-club.html'), '<!doctype html><title>Standalone download fixture</title>');
      const initial = await prepareSite(distDir);
      server = await createFixtureServer({ distDir });
      await use({ ...server, distDir, initial });
    } finally {
      await server?.close();
      await rm(distDir, { recursive: true, force: true });
    }
  },
});

async function gameReady(page) {
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#scene canvas')).toBeVisible();
  await page.waitForFunction(() => typeof document.querySelector('#scene canvas')?.getGameState === 'function');
}

async function cacheStatus(page) {
  return page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return null;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('CACHE_STATUS timed out')); }, 10000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer); channel.port1.close(); resolve(data);
      };
      worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
    });
  });
}

async function offlineReady(page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 45000 });
  await expect.poll(async () => (await cacheStatus(page))?.ready, { timeout: 45000 }).toBe(true);
  await expect(page.locator('#offline-status')).toContainText('可离线玩');
  return cacheStatus(page);
}

async function changeRelease(site, label) {
  const file = path.join(site.distDir, 'index.html');
  const html = await readFile(file, 'utf8');
  await writeFile(file, html.replace(/<html\b/, `<html data-test-release="${label}"`));
  return prepareSite(site.distDir);
}

async function state(page) {
  return page.locator('#scene canvas').evaluate(canvas => canvas.getGameState());
}

async function assertForeignCaches(page) {
  expect(await page.evaluate(async names => {
    const values = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const response = await cache.match(new URL('/unrelated-resource', location.origin));
      values.push(response ? await response.text() : null);
    }
    return values;
  }, FOREIGN_CACHES)).toEqual(FOREIGN_CACHES.map(() => 'preserve-me'));
}

async function seedForeignCaches(page, site) {
  await page.goto(site.projectUrl + 'fixture-host.html');
  await page.evaluate(async names => {
    for (const name of names) {
      const cache = await caches.open(name);
      await cache.put(new URL('/unrelated-resource', location.origin), new Response('preserve-me'));
    }
  }, FOREIGN_CACHES);
}

test('a complete cache survives eviction repair and supports offline aliases and real flight', async ({ page, context, site }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedForeignCaches(page, site);
  await page.goto(site.projectUrl + '?entry=first');
  await gameReady(page);
  const installed = await offlineReady(page);
  expect(installed.version).toBe(site.initial.version);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope)).toBe(site.projectUrl);
  await assertForeignCaches(page);

  // Browsers may evict CacheStorage while keeping the worker registered. A
  // connected reload must repair this same version, not advertise an empty cache.
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('little-sky:/game_demo/:')) await caches.delete(name);
    }
  });
  expect((await cacheStatus(page)).ready).toBe(false);
  await page.reload();
  await gameReady(page);
  expect((await offlineReady(page)).version).toBe(installed.version);
  await assertForeignCaches(page);

  const download = site.projectUrl + 'little-sky-club.html';
  const before = site.requests.filter(r => r.path === '/game_demo/little-sky-club.html').length;
  expect(await page.evaluate(async url => (await fetch(url, { cache: 'no-store' })).status, download)).toBe(200);
  expect(site.requests.filter(r => r.path === '/game_demo/little-sky-club.html').length).toBe(before + 1);

  await context.setOffline(true);
  for (const suffix of ['?entry=offline', 'index.html?entry=offline-alias']) {
    const response = await page.goto(site.projectUrl + suffix);
    expect(response.status()).toBe(200);
    await gameReady(page);
    expect((await offlineReady(page)).version).toBe(installed.version);
  }
  expect(await page.evaluate(async url => {
    try { await fetch(url, { cache: 'no-store' }); return false; }
    catch { return true; }
  }, download)).toBe(true);
  await assertForeignCaches(page);

  await page.locator('[data-id="747"]').click();
  await expect(page.locator('#selected-name')).toContainText('747');
  await page.locator('#start-button').click();
  await expect.poll(async () => (await state(page)).audio.level).toBeGreaterThan(0);
  expect((await state(page)).phase).toBe('flying');
  expect((await state(page)).gearDown).toBe(false);
  await page.locator('#home-button').click();
  await expect(page.locator('#hangar-ui')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an update waits during flight and only the menu tab that requests it reloads', async ({ page, context, site }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await seedForeignCaches(page, site);
  await page.goto(site.projectUrl);
  await gameReady(page);
  const first = await offlineReady(page);
  await page.evaluate(() => { window.__documentIdentity = 'flight-original'; });
  await page.locator('#start-button').click();
  // Fly to a safe edge using the actual controls so the update can remain
  // waiting without a collision ending this uninterrupted flight.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await state(page)).position[0], { timeout: 20000 }).toBe(20);
  await page.keyboard.up('ArrowRight');

  const replacement = await changeRelease(site, 'second');
  expect(replacement.version).not.toBe(first.version);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    window.__updateRequestError = null;
    // Observe the actual waiting worker below. The registration job promise
    // can stay queued independently of the application's update-ready state.
    void registration.update().catch(error => { window.__updateRequestError = error.message; });
  });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting), null, { timeout: 45000 });
  expect((await state(page)).phase).toBe('flying');
  expect((await cacheStatus(page)).version).toBe(first.version);
  expect(await page.evaluate(() => window.__documentIdentity)).toBe('flight-original');
  await expect(page.locator('#update-game')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-test-release', 'second');
  expect(await page.evaluate(() => window.__updateRequestError)).toBeNull();

  // Join the existing controlled version after the replacement is waiting.
  // This second real game tab must survive another tab requesting activation.
  const other = await context.newPage();
  await other.goto(site.projectUrl);
  await gameReady(other);
  await expect.poll(async () => (await cacheStatus(other))?.ready).toBe(true);
  await other.evaluate(() => { window.__documentIdentity = 'other-original'; });
  await page.bringToFront();

  await page.locator('#home-button').click();
  await expect(page.locator('#update-game')).toBeVisible();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#update-game').click(),
  ]);
  await gameReady(page);
  expect((await offlineReady(page)).version).toBe(replacement.version);
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'second');
  expect(await page.evaluate(() => window.__documentIdentity)).toBeUndefined();
  expect(await other.evaluate(() => window.__documentIdentity)).toBe('other-original');
  await expect(other.locator('html')).not.toHaveAttribute('data-test-release', 'second');
  await assertForeignCaches(page);
  expect(errors).toEqual([]);
});

test('an integrity-failing replacement leaves the previous version playable offline', async ({ page, context, site }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site.projectUrl);
  await gameReady(page);
  const first = await offlineReady(page);
  const replacement = await changeRelease(site, 'corrupted');
  expect(replacement.version).not.toBe(first.version);
  const asset = replacement.entries.find(entry => entry.url.endsWith('.js'));
  expect(asset).toBeTruthy();
  site.setFault(new URL(asset.url, site.projectUrl).pathname, {
    status: 200,
    body: '/* Deliberately incomplete CDN asset: integrity must reject it. */',
    headers: { 'Content-Type': 'text/javascript' },
  });
  const attempted = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const outcome = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Replacement installation did not finish')), 45000);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        const changed = () => {
          if (worker.state === 'redundant' || worker.state === 'installed') {
            clearTimeout(timeout); resolve(worker.state);
          }
        };
        worker.addEventListener('statechange', changed);
        changed();
      }, { once: true });
    });
    await registration.update();
    return outcome;
  });
  expect(attempted).toBe('redundant');
  expect((await cacheStatus(page)).version).toBe(first.version);
  expect((await cacheStatus(page)).ready).toBe(true);
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(false);
  await expect(page.locator('#update-game')).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await gameReady(page);
  expect((await offlineReady(page)).version).toBe(first.version);
  await expect(page.locator('html')).not.toHaveAttribute('data-test-release', 'corrupted');
  await page.locator('#start-button').click();
  await expect.poll(async () => (await state(page)).audio.level).toBeGreaterThan(0);
  expect((await state(page)).phase).toBe('flying');
  expect(errors).toEqual([]);
});


test('a failed first script load shows a useful retry and recovers when connectivity returns', async ({ page, context, site }) => {
  const blockedScript = '**/assets/*.js';
  await context.route(blockedScript, route => route.abort('failed'));
  await page.goto(site.projectUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loading')).toBeVisible();
  await expect(page.locator('#loading-message')).toHaveText('这次没能打开天空');
  await expect(page.locator('#loading-note')).toContainText('检查网络连接');
  await expect(page.locator('#loading-retry')).toBeVisible();
  await expect(page.locator('#loading')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await context.unroute(blockedScript);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#loading-retry').click(),
  ]);
  await gameReady(page);
  await expect(page.locator('#start-button')).toBeVisible();
});
