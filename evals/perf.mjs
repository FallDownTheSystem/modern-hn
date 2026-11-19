// Main-thread cost of each reader action, on fixtures of Hacker News pages.
//
//   node perf.mjs --label base            measure and save results/base.json
//   node perf.mjs --compare base          measure and show the change from results/base.json
//   node perf.mjs --only jump,scroll      run some scenarios only
//   node perf.mjs --runs 7 --copies 30 --cpu 4
//
// MHN_SCRIPT=<file> measures another copy of the userscript.
// Each number is the median of the runs, in milliseconds.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser, open, HN, SCRIPT_PATH } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const RUNS = Number(arg('runs', 5));
const COPIES = Number(arg('copies', 30));
const CPU = Number(arg('cpu', 1));
const ONLY = arg('only', '') ? arg('only').split(',') : null;
const LABEL = arg('label', 'last');
const COMPARE = arg('compare', '');
const RESULTS = fileURLToPath(new URL('results/', import.meta.url));
const LONG = `/item?copies=${COPIES}`;

const frames = (page, count = 2) => page.evaluate(async (n) => {
	for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}, count);

// A page with counters of the time that the main thread has used.
async function start(prefs) {
	const page = await open(1440, { height: 900, quiet: true });
	const cdp = await page.context().newCDPSession(page);
	// The first page puts the tab in the process of the site; the counters
	// start again when the process changes.
	await page.goto(`${HN}/login`);
	if (prefs) await page.evaluate((value) => localStorage.setItem('mhn-prefs', JSON.stringify(value)), prefs);
	await cdp.send('Performance.enable');
	if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
	const read = async () => {
		const all = (await cdp.send('Performance.getMetrics')).metrics;
		const get = (name) => all.find((metric) => metric.name === name).value * 1000;
		return { task: get('TaskDuration'), style: get('RecalcStyleDuration'), layout: get('LayoutDuration'), script: get('ScriptDuration') };
	};
	// Runs an action, lets the page paint, and gives the time that the action used.
	// "per" divides the time of an action that repeats.
	page.cost = async (act, per = 1) => {
		const before = await read();
		const extra = await act();
		await frames(page);
		const after = await read();
		const used = {};
		for (const key of Object.keys(after)) used[key] = (after[key] - before[key]) / per;
		return { ...used, ...extra };
	};
	return page;
}

async function longPage(prefs) {
	const page = await start(prefs);
	await page.goto(`${HN}${LONG}`);
	await page.waitForTimeout(300);
	await frames(page);
	return page;
}

const input = (page, name, value) => page.evaluate(([n, v]) => {
	const all = [...document.querySelectorAll(`#mhn-settings [name="${n}"]`)];
	const control = all.find((node) => node.type !== 'radio' || node.value === v);
	if (control.type === 'checkbox' || control.type === 'radio') control.checked = v !== false;
	else control.value = v;
	control.dispatchEvent(new Event('input', { bubbles: true }));
}, [name, value]);

// A slider that moves one step in each frame, as a drag does.
const drag = (page, name, from, step, count) => page.evaluate(async ([n, first, by, steps]) => {
	const control = document.querySelector(`#mhn-settings [name="${n}"]`);
	let worst = 0;
	let last = performance.now();
	for (let i = 0; i < steps; i++) {
		control.value = first + i * by;
		control.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const now = performance.now();
		worst = Math.max(worst, now - last);
		last = now;
	}
	return { worstFrame: worst };
}, [name, from, step, count]);

async function loadOf(path, prefs) {
	const page = await start(prefs);
	const cost = await page.cost(async () => {
		await page.goto(`${HN}${path}`, { waitUntil: 'load' });
		return page.evaluate(() => ({ ready: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd }));
	});
	await page.context().close();
	return cost;
}

const SCENARIOS = {
	async load() {
		return {
			'load front': await loadOf('/'),
			'load story, 31 comments': await loadOf('/item'),
			'load story, long': await loadOf(LONG),
			'load story, long, fold at 0': await loadOf(LONG, { fold: 0 }),
			'load story, long, fold at 1': await loadOf(LONG, { fold: 1 }),
			'load threads': await loadOf('/threads?id=dang'),
		};
	},

	async settings() {
		const page = await longPage();
		await page.click('[popovertarget="mhn-settings"]');
		await page.waitForTimeout(300);
		const out = { 'idle (noise floor)': await page.cost(async () => {}) };
		for (const [name, value] of [['tone', '40'], ['lightness', '60'], ['contrast', '60'], ['theme', 'light'], ['theme', 'dark'], ['size', '17'], ['weight', '450'], ['width', '120'], ['font', 'system-serif'], ['heading', 'system-mono'], ['votes', true], ['pin', false]]) {
			out[`set ${name} ${value}`] = await page.cost(() => input(page, name, value));
		}
		out['drag tone, each step'] = await page.cost(() => drag(page, 'tone', -50, 5, 20), 20);
		out['drag size, each step'] = await page.cost(() => drag(page, 'size', 13, 0.5, 14), 14);
		out['drag width, each step'] = await page.cost(() => drag(page, 'width', 80, 5, 14), 14);
		await page.context().close();
		return out;
	},

	async fold() {
		const page = await longPage();
		const pick = () => page.evaluate(() => {
			const rows = [...document.querySelectorAll('tr.comtr')];
			// The thread with the most replies in the middle of the page.
			const middle = rows.slice(Math.floor(rows.length / 2), Math.floor(rows.length / 2) + 40);
			const row = middle.reduce((best, r) => (Number(r.querySelector('a.togg').getAttribute('n')) > Number(best.querySelector('a.togg').getAttribute('n')) ? r : best));
			row.scrollIntoView({ block: 'center' });
			return row.id;
		});
		const id = await pick();
		await frames(page, 3);
		const click = (selector) => page.evaluate(([rowId, s]) => document.getElementById(rowId).querySelector(s).click(), [id, selector]);
		const out = {
			'fold with the control': await page.cost(() => click('a.togg')),
			'open with the control': await page.cost(() => click('a.togg')),
			'fold with the comment head': await page.cost(() => click('td.default > div')),
			'open with the comment head': await page.cost(() => click('td.default > div')),
		};
		// The pointer moves down the gutter of the rows in view, 3 positions in each row.
		// The positions come from the comments near the view only: a read of a
		// position makes the browser lay out a comment that it skipped.
		const pointsOf = (selector) => page.evaluate(([rowId, s]) => {
			const rows = [...document.querySelectorAll('tr.comtr')];
			const at = rows.indexOf(document.getElementById(rowId));
			return rows.slice(at - 6, at + 6).flatMap((row) => [...row.querySelectorAll(s)]).map((cell) => cell.getBoundingClientRect())
				.filter((r) => r.width > 0 && r.top > 80 && r.top < innerHeight - 40)
				.flatMap((r) => [0.2, 0.5, 0.8].map((part) => [r.left + r.width * part, r.top + 8 + 20 * part]));
		}, [id, selector]);
		for (const [label, selector] of [['pointer move in the gutter', 'td.ind'], ['pointer move on the text', '.commtext']]) {
			const points = await pointsOf(selector);
			await frames(page, 3);
			out[label] = await page.cost(async () => {
				for (const [x, y] of points) await page.mouse.move(x, y);
			}, points.length || 1);
		}
		await page.context().close();
		return out;
	},

	async jump() {
		const page = await longPage();
		const press = (key, count) => async () => {
			for (let i = 0; i < count; i++) {
				await page.keyboard.press(key);
				await frames(page, 1);
			}
		};
		const out = {};
		out['J from the top, each'] = await page.cost(press('j', 20), 20);
		await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight * 0.85));
		await frames(page, 3);
		out['J near the end, each'] = await page.cost(press('j', 20), 20);
		out['K near the end, each'] = await page.cost(press('k', 20), 20);
		await page.evaluate(() => scrollTo(0, 2000));
		await frames(page, 3);
		out['K near the top, each'] = await page.cost(press('k', 5), 5);
		out['button: next thread'] = await page.cost(async () => {
			await page.evaluate(() => document.querySelector('[data-mhn-jump="next"]').click());
			await page.waitForTimeout(600);
		});
		out['button: bottom'] = await page.cost(async () => {
			await page.evaluate(() => document.querySelector('[data-mhn-jump="bottom"]').click());
			await page.waitForTimeout(1200);
		});
		await page.context().close();
		return out;
	},

	async scroll() {
		const page = await longPage();
		const pass = () => page.evaluate(async () => {
			scrollTo(0, 0);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const times = [];
			let last = performance.now();
			const end = () => document.documentElement.scrollHeight - innerHeight - 1;
			while (scrollY < end() && times.length < 3000) {
				scrollBy(0, 700);
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const now = performance.now();
				times.push(now - last);
				last = now;
			}
			return { worstFrame: Math.max(...times), slowFrames: times.filter((time) => time > 34).length, frames: times.length };
		});
		const out = {
			'scroll the page, first time': await page.cost(pass),
			'scroll the page, second time': await page.cost(pass),
		};
		await page.context().close();
		return out;
	},

	async filter() {
		const page = await longPage();
		await page.keyboard.press('/');
		await page.evaluate(() => document.querySelector('input[name="mhn-search-scope"][value="page"]').click());
		await frames(page);
		const type = (text) => page.evaluate((value) => {
			const field = document.querySelector('.mhn-search input[role="searchbox"]');
			field.value = value;
			field.dispatchEvent(new Event('input', { bubbles: true }));
		}, text);
		const out = {};
		out['filter: first letter'] = await page.cost(() => type('m'));
		out['filter: a word'] = await page.cost(() => type('matrix'));
		out['filter: two words'] = await page.cost(() => type('matrix server'));
		out['filter: clear'] = await page.cost(() => type(''));
		await page.context().close();
		return out;
	},

	async more() {
		const page = await start();
		await page.goto(`${HN}/`);
		await frames(page);
		const out = {
			'more stories': await page.cost(async () => {
				const before = await page.evaluate(() => document.querySelectorAll('tr.athing').length);
				await page.evaluate(() => document.querySelector('a.morelink').click());
				await page.waitForFunction((count) => document.querySelectorAll('tr.athing').length > count, before);
			}),
		};
		await page.context().close();
		return out;
	},

	async resize() {
		const page = await longPage();
		const out = {
			'window to 1000 px': await page.cost(() => page.setViewportSize({ width: 1000, height: 900 })),
			'window to 390 px': await page.cost(() => page.setViewportSize({ width: 390, height: 900 })),
		};
		await page.context().close();
		return out;
	},
};

const median = (values) => {
	const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

const samples = {};
for (let run = 0; run < RUNS; run++) {
	for (const [name, scenario] of Object.entries(SCENARIOS)) {
		if (ONLY && !ONLY.includes(name)) continue;
		let result;
		try {
			result = await scenario();
		} catch (error) {
			console.log(`run ${run + 1}: ${name} failed: ${error.message.split('\n')[0]}`);
			continue;
		}
		for (const [metric, fields] of Object.entries(result)) {
			for (const [field, value] of Object.entries(fields)) ((samples[metric] ??= {})[field] ??= []).push(value);
		}
	}
	process.stdout.write(`run ${run + 1} of ${RUNS} done\n`);
}
await browser.close();

const metrics = {};
for (const [metric, fields] of Object.entries(samples)) {
	metrics[metric] = Object.fromEntries(Object.entries(fields).map(([field, values]) => [field, Math.round(median(values) * 10) / 10]));
}

let base = null;
if (COMPARE) base = JSON.parse(readFileSync(`${RESULTS}${COMPARE}.json`, 'utf8')).metrics;

const cell = (value, width = 8) => (value === undefined ? '' : String(value)).padStart(width);
console.log(`\n${'action'.padEnd(34)}${cell('task')}${cell('style')}${cell('layout')}${cell('script')}${cell('worst', 9)}${base ? cell(`vs ${COMPARE}`, 16) : ''}`);
let total = 0;
let baseTotal = 0;
for (const [metric, fields] of Object.entries(metrics)) {
	let change = '';
	const before = base && base[metric];
	if (before) {
		total += fields.task;
		baseTotal += before.task;
		const delta = fields.task - before.task;
		// A change below 2 ms or 10% is inside the noise of the measurement.
		const real = Math.abs(delta) >= 2 && Math.abs(delta) >= before.task * 0.1;
		change = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${real ? (delta < 0 ? ' better' : ' WORSE') : ''}`;
	}
	console.log(`${metric.padEnd(34)}${cell(fields.task)}${cell(fields.style)}${cell(fields.layout)}${cell(fields.script)}${cell(fields.worstFrame, 9)}${cell(change, 16)}`);
}
if (base) console.log(`\ntotal task time: ${baseTotal.toFixed(0)} -> ${total.toFixed(0)} ms (${((total / baseTotal - 1) * 100).toFixed(1)}%)`);

mkdirSync(RESULTS, { recursive: true });
writeFileSync(`${RESULTS}${LABEL}.json`, JSON.stringify({ script: SCRIPT_PATH, copies: COPIES, runs: RUNS, cpu: CPU, metrics }, null, '\t'));
console.log(`\nsaved results/${LABEL}.json (${RUNS} runs, ${COPIES} copies of the comments, CPU slowdown ${CPU})`);
