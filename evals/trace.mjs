// Where the main thread spends its time during one action.
//
//   node trace.mjs tone            a change of the tone setting on the long thread
//   node trace.mjs load            the load of the long thread
//   node trace.mjs filter --copies 30 --top 15
//
// The table gives the self time of each kind of browser work, the number of
// events, and the number of elements that the style work visited.

import { browser, open, HN } from './lib.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const COPIES = Number(arg('copies', 30));
const TOP = Number(arg('top', 14));
const LONG = `${HN}/item?copies=${COPIES}`;

const frames = (page, count = 2) => page.evaluate(async (n) => {
	for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}, count);
const setting = (name, value) => async (page) => {
	await page.evaluate(([n, v]) => {
		const all = [...document.querySelectorAll(`#mhn-settings [name="${n}"]`)];
		const control = all.find((node) => node.type !== 'radio' || node.value === v);
		if (control.type === 'checkbox' || control.type === 'radio') control.checked = v !== false;
		else control.value = v;
		control.dispatchEvent(new Event('input', { bubbles: true }));
	}, [name, value]);
};
const withPanel = async (page) => {
	await page.goto(LONG);
	await page.click('[popovertarget="mhn-settings"]');
	await page.waitForTimeout(400);
};
const longPage = async (page) => {
	await page.goto(LONG);
	await page.waitForTimeout(400);
};
const type = (text) => (page) => page.evaluate((value) => {
	const field = document.querySelector('.mhn-search input[role="searchbox"]');
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}, text);
const filterOpen = async (page) => {
	await longPage(page);
	await page.keyboard.press('/');
	await page.evaluate(() => document.querySelector('input[name="mhn-search-scope"][value="page"]').click());
	await frames(page);
};

// Three pointer positions in each part of the first 12 comments. The parts are
// read before the trace starts: a read of a position makes the browser lay
// out a comment that it skipped.
const pointsOf = (selector) => async (page) => {
	await longPage(page);
	await page.evaluate(() => document.querySelectorAll('tr.comtr')[1].scrollIntoView());
	await frames(page, 3);
	page.points = await page.evaluate((s) => [...document.querySelectorAll('tr.comtr')].slice(0, 12).flatMap((row) => [...row.querySelectorAll(s)]).map((cell) => cell.getBoundingClientRect()).filter((r) => r.width > 0 && r.top > 80 && r.top < innerHeight - 40).flatMap((r) => [0.2, 0.5, 0.8].map((at) => [r.left + r.width * at, r.top + 8 + 20 * at])), selector);
	await frames(page, 3);
};
const movePointer = async (page) => {
	console.log(`${page.points.length} pointer positions`);
	for (const [x, y] of page.points) await page.mouse.move(x, y);
};

// Each action has a "before" step, which the trace leaves out, and an "act" step.
const ACTIONS = {
	tone: { before: withPanel, act: setting('tone', '40') },
	theme: { before: withPanel, act: setting('theme', 'light') },
	size: { before: withPanel, act: setting('size', '17') },
	weight: { before: withPanel, act: setting('weight', '450') },
	font: { before: withPanel, act: setting('font', 'system-serif') },
	load: { before: (page) => page.goto(`${HN}/login`), act: (page) => page.goto(LONG, { waitUntil: 'load' }) },
	loadfront: { before: (page) => page.goto(`${HN}/login`), act: (page) => page.goto(`${HN}/`, { waitUntil: 'load' }) },
	fold0: {
		before: async (page) => {
			await page.goto(`${HN}/login`);
			await page.evaluate(() => localStorage.setItem('mhn-prefs', JSON.stringify({ fold: 0 })));
		},
		act: (page) => page.goto(LONG, { waitUntil: 'load' }),
	},
	filter: { before: filterOpen, act: type('matrix') },
	filterclear: { before: async (page) => { await filterOpen(page); await type('matrix')(page); await frames(page); }, act: type('') },
	jumpend: {
		before: async (page) => {
			await longPage(page);
			await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight * 0.85));
			await frames(page, 3);
		},
		act: async (page) => {
			for (let i = 0; i < 10; i++) {
				await page.keyboard.press('j');
				await frames(page, 1);
			}
		},
	},
	bottom: {
		before: longPage,
		act: async (page) => {
			await page.evaluate(() => document.querySelector('[data-mhn-jump="bottom"]').click());
			await page.waitForTimeout(1200);
		},
	},
	scroll: {
		before: longPage,
		act: (page) => page.evaluate(async () => {
			for (let i = 0; i < 60; i++) {
				scrollBy(0, 700);
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
		}),
	},
	hover: { before: pointsOf('td.ind'), act: movePointer },
	text: { before: pointsOf('.commtext'), act: movePointer },
	resize: { before: longPage, act: (page) => page.setViewportSize({ width: 1000, height: 900 }) },
};

const name = args[0];
// "set:weight=450" is a change of any setting; --css adds style rules for a trial.
const custom = /^set:(\w+)=(.*)$/.exec(name || '');
const EXTRA_CSS = arg('css', '');
// "js:<code>" runs code in the long thread, for a trial.
const code = /^js:(.*)$/s.exec(name || '');
const action = code ? { before: withPanel, act: (page) => page.evaluate(code[1]) } : custom ?{ before: withPanel, act: setting(custom[1], custom[2] === 'true' ? true : custom[2] === 'false' ? false : custom[2]) } : ACTIONS[name];
if (!action) {
	console.log(`actions: ${Object.keys(ACTIONS).join(', ')}`);
	await browser.close();
	process.exit(1);
}

const page = await open(1440, { height: 900, quiet: true });
await action.before(page);
if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
await frames(page, 4);
// --why adds the reason for each style invalidation; it slows the page, so the times are then too high.
const WHY = args.includes('--why');
await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'v8', ...(WHY ? ['disabled-by-default-devtools.timeline.invalidationTracking'] : []), ...(args.includes('--selectors') ? ['disabled-by-default-blink.debug'] : [])] });
await action.act(page);
await frames(page);
const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
await browser.close();

// The main thread of the page is the renderer main thread with the most work.
const threadNames = new Map(events.filter((event) => event.name === 'thread_name').map((event) => [`${event.pid}:${event.tid}`, event.args.name]));
const complete = events.filter((event) => event.ph === 'X' && threadNames.get(`${event.pid}:${event.tid}`) === 'CrRendererMain');
const busy = new Map();
for (const event of complete) busy.set(`${event.pid}:${event.tid}`, (busy.get(`${event.pid}:${event.tid}`) || 0) + 1);
const main = [...busy].sort((a, b) => b[1] - a[1])[0]?.[0];
const mainEvents = complete.filter((event) => `${event.pid}:${event.tid}` === main).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

const rows = new Map();
const row = (key) => {
	if (!rows.has(key)) rows.set(key, { self: 0, count: 0, elements: 0 });
	return rows.get(key);
};
const stack = [];
for (const event of mainEvents) {
	while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
	const entry = row(event.name);
	entry.self += event.dur;
	entry.count++;
	entry.elements += event.args?.elementCount || 0;
	if (stack.length) row(stack.at(-1).name).self -= event.dur;
	stack.push(event);
}

if (WHY) {
	const reasons = new Map();
	for (const event of events) {
		if (!/InvalidationTracking$/.test(event.name)) continue;
		const data = event.args?.data || {};
		const key = `${event.name.replace('InvalidationTracking', '')} | ${(data.nodeName || '').slice(0, 40)} | ${data.reason || data.invalidatedSelectorId || ''} ${data.extraData || data.changedClass || data.changedAttribute || data.changedPseudo || ''}`;
		reasons.set(key, (reasons.get(key) || 0) + 1);
	}
	console.log('\ninvalidations (kind | node | reason):');
	for (const [key, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(count).padStart(7), key);
}

// --selectors gives the time and the match attempts of each selector. The times are too high then.
if (args.includes('--selectors')) {
	const selectors = new Map();
	for (const event of events) {
		for (const timing of event.args?.selector_stats?.selector_timings || []) {
			const entry = selectors.get(timing.selector) || { time: 0, attempts: 0, matches: 0 };
			entry.time += timing['elapsed (us)'];
			entry.attempts += timing.match_attempts;
			entry.matches += timing.match_count;
			selectors.set(timing.selector, entry);
		}
	}
	const all = [...selectors].sort((a, b) => b[1].time - a[1].time);
	console.log(`\nselectors: ${all.length}, ${(all.reduce((sum, [, entry]) => sum + entry.time, 0) / 1000).toFixed(1)} ms, ${all.reduce((sum, [, entry]) => sum + entry.attempts, 0)} attempts`);
	console.log(`${'ms'.padStart(7)}${'attempts'.padStart(9)}${'matches'.padStart(8)}  selector`);
	for (const [selector, entry] of all.slice(0, Number(arg('selectors-top', 25)))) console.log(`${(entry.time / 1000).toFixed(2).padStart(7)}${String(entry.attempts).padStart(9)}${String(entry.matches).padStart(8)}  ${selector.slice(0, 110)}`);
}

const passes = mainEvents.filter((event) => event.name === 'UpdateLayoutTree').map((event) => `${event.args?.elementCount ?? '?'} (${(event.dur / 1000).toFixed(1)} ms)`);
if (passes.length <= 12) console.log(`style passes: ${passes.join(', ')}`);

const sorted = [...rows].sort((a, b) => b[1].self - a[1].self);
const total = sorted.reduce((sum, [, entry]) => sum + entry.self, 0) / 1000;
console.log(`\n${name}: ${total.toFixed(1)} ms on the main thread, ${rows.get('UpdateLayoutTree')?.elements || 0} elements styled in ${rows.get('UpdateLayoutTree')?.count || 0} passes\n`);
console.log(`${'work'.padEnd(40)}${'self ms'.padStart(9)}${'events'.padStart(8)}${'elements'.padStart(10)}`);
for (const [key, entry] of sorted.slice(0, TOP)) {
	console.log(`${key.padEnd(40)}${(entry.self / 1000).toFixed(1).padStart(9)}${String(entry.count).padStart(8)}${String(entry.elements || '').padStart(10)}`);
}
