import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUILD_ORIGIN = 'https://build.invalid/';
const digest = (contents) => createHash('sha256').update(contents).digest('base64');

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  }
  return result;
}

/** Prepare a Vite output directory without changing source HTML or standalone. */
export async function prepareSite(distDir = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)))) {
  distDir = path.resolve(distDir);
  async function readAsset(relative) {
    const filename = path.resolve(distDir, relative);
    if (filename !== distDir && !filename.startsWith(`${distDir}${path.sep}`)) throw new Error(`Asset escapes output directory: ${relative}`);
    if (!(await stat(filename)).isFile()) throw new Error(`Expected a built file: ${relative}`);
    return readFile(filename);
  }
  function relativeAsset(reference, from = 'index.html') {
    const url = new URL(reference, new URL(from, BUILD_ORIGIN));
    if (url.origin !== new URL(BUILD_ORIGIN).origin) throw new Error(`Only local production assets can be precached: ${reference}`);
    if (url.search || url.hash) throw new Error(`Expected a content-hashed asset URL without a query: ${reference}`);
    return decodeURIComponent(url.pathname.slice(1));
  }

  let html = (await readAsset('index.html')).toString('utf8');
  // A small stylesheet costs more in connection latency than transfer time.
  // Inline the built CSS so the HTML can paint its loader without another RTT.
  for (const match of [...html.matchAll(/<link\b[^>]*>/gi)]) {
    const attrs = attributes(match[0]);
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet')) continue;
    const relative = relativeAsset(attrs.href);
    let css = (await readAsset(relative)).toString('utf8');
    css = css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi, (whole, quote, quoted, unquoted) => {
      const value = (quoted ?? unquoted).trim();
      if (!value || /^(?:data:|blob:|https?:|\/\/|#|\/)/i.test(value)) return whole;
      const resolved = new URL(value, new URL(relative, BUILD_ORIGIN));
      return `url(${JSON.stringify(`.${resolved.pathname}${resolved.search}${resolved.hash}`)})`;
    });
    html = html.replace(match[0], () => `<style data-inline-app-css>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
  }
  html = html.replace(/<html\b([^>]*)>/i, (_whole, attrs) => `<html${attrs.replace(/\sdata-online\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')} data-online="true">`);
  await writeFile(path.join(distDir, 'index.html'), html);

  const assets = new Set();
  const queue = [];
  function addAsset(reference, from) {
    const relative = relativeAsset(reference, from);
    if (!relative.endsWith('.js')) return;
    if (!assets.has(relative)) { assets.add(relative); queue.push(relative); }
  }
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    if (tag[0].toLowerCase().startsWith('<script') && attrs.src) addAsset(attrs.src);
    if (attrs.rel === 'modulepreload' && attrs.href) addAsset(attrs.href);
  }
  // Vite's static/dynamic relative imports describe the actual JavaScript graph;
  // do not cache the separately offered large standalone download or stray files.
  while (queue.length) {
    const relative = queue.shift();
    const source = (await readAsset(relative)).toString('utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s*(?:[^"'`;]*?\bfrom\s*)?(["'])(\.{1,2}\/[^"']+\.js)\1/g)) addAsset(match[2], relative);
    for (const match of source.matchAll(/\bimport\s*\(\s*(["'])(\.{1,2}\/[^"']+\.js)\1\s*\)/g)) addAsset(match[2], relative);
  }
  if (!assets.size) throw new Error('The built HTML has no JavaScript entry to precache');
  const entries = [];
  for (const relative of ['index.html', ...[...assets].sort()]) {
    const contents = await readAsset(relative);
    entries.push({ url: relative === 'index.html' ? './' : `./${relative}`, integrity: `sha256-${digest(contents)}` });
  }
  // Generator changes also get a new cache, so a failed replacement install
  // can never delete the active version's cache, even with identical assets.
  const generator = await readFile(fileURLToPath(import.meta.url));
  const version = createHash('sha256').update(JSON.stringify(entries)).update(generator).digest('hex').slice(0, 20);
  const worker = `/* Little Sky Club: generated, complete-version offline cache. */
const VERSION = ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(entries, null, 2)};
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'little-sky:' + SCOPE.pathname + ':';
const CACHE = PREFIX + VERSION;
const SHELL = SCOPE.href;
const INDEX_PATH = new URL('index.html', SCOPE).pathname;
const URLS = PRECACHE.map(entry => new URL(entry.url, SCOPE).href);
const ASSETS = new Set(URLS.filter(url => url !== SHELL));

async function populateCache(timeoutMs) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const cache = await caches.open(CACHE);
    // addAll is atomic; integrity also rejects mixed CDN publication versions.
    await cache.addAll(PRECACHE.map(entry => new Request(new URL(entry.url, SCOPE), {
      integrity: entry.integrity,
      cache: entry.url === './' ? 'no-cache' : 'force-cache',
      credentials: 'same-origin',
      mode: 'same-origin',
      signal: abort.signal,
    })));
  } finally { clearTimeout(timer); }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try { await populateCache(45000); }
    catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    // The first visit can now be reopened offline. Replacements still wait
    // naturally unless a user explicitly requests SKIP_WAITING from the menu.
    await self.clients.claim();
  })());
});

let repairInFlight;
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'CACHE_REPAIR' && event.ports[0]) {
    event.waitUntil((async () => {
      // Storage eviction does not uninstall the worker. Repair this exact
      // version once requested; a newer network HTML fails its old integrity.
      // Unlike a failed new install, repair must preserve any surviving entries.
      if (!repairInFlight) repairInFlight = populateCache(25000)
        .then(() => true, () => false).finally(() => { repairInFlight = null; });
      const ready = await repairInFlight;
      event.ports[0].postMessage({ type: 'CACHE_STATUS', ready, version: VERSION });
    })());
  } else if (event.data?.type === 'CACHE_STATUS' && event.ports[0]) {
    event.waitUntil((async () => {
      let ready = false;
      try {
        const cache = await caches.open(CACHE);
        ready = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
      } catch { /* Storage can be unavailable or evicted. */ }
      event.ports[0].postMessage({ type: 'CACHE_STATUS', ready, version: VERSION });
    })());
  }
});

const offlinePage = () => new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小小机长</title><body style="font-family:system-ui,sans-serif;background:#e9f7f4;color:#234d45;padding:12vh 8vw"><h1>天空暂时连接不上</h1><p>这台设备上的离线内容还没准备好。联网后再试一次吧。</p><button onclick="location.reload()" style="font:inherit;padding:12px 24px">重新打开</button></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const navigation = request.mode === 'navigate'
    && (url.pathname === SCOPE.pathname || url.pathname === INDEX_PATH);
  const asset = ASSETS.has(url.href);
  if (!navigation && !asset) return;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(navigation ? SHELL : request);
      if (saved) return saved;
    } catch { /* A cache failure must not break an otherwise online game. */ }
    // Never write a newer network HTML into an older immutable cache version.
    try { return await fetch(request); }
    catch (error) {
      if (navigation) return offlinePage();
      throw error;
    }
  })());
});
`;
  await writeFile(path.join(distDir, 'sw.js'), worker);
  return { version, entries, distDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await prepareSite(process.argv[2]);
  console.log(`Prepared online game: ${result.entries.length} cached files, version ${result.version}`);
}
