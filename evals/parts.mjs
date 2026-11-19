// Time of each start-up part of the userscript, on a trial copy that records it.
//
//   node parts.mjs [path]          default path: the long thread
//
// The median of 7 loads, in milliseconds.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
execFileSync(process.execPath, [here('variant.mjs'), 'parts', '\\t\\t\\tpart\\(\\);', '\t\t\tconst began = performance.now(); part(); const all = (window.__parts ??= {}); all[part.name] = (all[part.name] || 0) + performance.now() - began;']);
process.env.MHN_SCRIPT = here('results/parts.user.js');
const { browser, open, HN } = await import('./lib.mjs');

const path = process.argv[2] || '/item?copies=30';
const runs = [];
for (let run = 0; run < 7; run++) {
	const page = await open(1440, { height: 900, quiet: true });
	await page.goto(`${HN}${path}`);
	await page.waitForTimeout(300);
	runs.push(await page.evaluate(() => window.__parts));
	await page.context().close();
}
await browser.close();
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
let total = 0;
for (const name of Object.keys(runs[0])) {
	const time = median(runs.map((run) => run[name]));
	total += time;
	console.log(name.padEnd(24), time.toFixed(1).padStart(7));
}
console.log('total'.padEnd(24), total.toFixed(1).padStart(7));
