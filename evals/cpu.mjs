// JavaScript profile of a page load: the functions of the userscript by self time.
//
//   node cpu.mjs [path]            default path: the long thread
//
// The sample interval is 50 microseconds; the times add up over 5 loads.

import { browser, open, HN } from './lib.mjs';

const path = process.argv[2] || '/item?copies=30';
const self = new Map();
let total = 0;
for (let run = 0; run < 5; run++) {
	const page = await open(1440, { height: 900, quiet: true });
	const cdp = await page.context().newCDPSession(page);
	await page.goto(`${HN}/login`);
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
	await cdp.send('Profiler.start');
	await page.goto(`${HN}${path}`, { waitUntil: 'load' });
	await page.waitForTimeout(200);
	const { profile } = await cdp.send('Profiler.stop');
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	profile.samples.forEach((id, i) => {
		const frame = byId.get(id).callFrame;
		if (frame.functionName === '(idle)' || frame.functionName === '(program)') return;
		const key = `${frame.functionName || '(anonymous)'}:${frame.lineNumber + 1}`;
		const time = profile.timeDeltas[i] / 1000;
		self.set(key, (self.get(key) || 0) + time);
		total += time;
	});
	await page.context().close();
}
await browser.close();
console.log(`${(total / 5).toFixed(1)} ms of JavaScript for each load of ${path}\n`);
for (const [key, time] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log((time / 5).toFixed(2).padStart(7), key);
