import { build } from 'esbuild';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'inline',
  write: false,
  outfile: 'standalone.js',
});
const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text;
if (!js || !css) throw new Error('Expected both bundled JavaScript and CSS');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
const thirdPartyNotices = await readFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), 'utf8');
const scriptTag = /<script\s+type="module"\s+src="\/src\/main\.js"><\/script>/;
if (!scriptTag.test(html)) throw new Error('Cannot find application entry script');
html = html
  .replace('</head>', () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>\n<!--\n${thirdPartyNotices.replace(/--/g, '- -')}\n-->\n  </head>`)
  .replace(scriptTag, () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`)
  // In a file:// document, ./ opens the containing directory. Reload the same
  // standalone document when the child presses the home logo instead.
  .replace('class="brand" href="./"', 'class="brand" href=""');
const output = path.join(root, 'dist/little-sky-club.html');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Standalone game: ${output} (${(await stat(output)).size} bytes)`);
