// Behaviour checks for the userscript, on fixtures of Hacker News pages.
//
//   node check.mjs                  run the checks
//   node check.mjs --save-layout    save the box of each element as the reference
//   node check.mjs --only layout,jump
//
// The layout check compares the box of each element with the saved reference.
// Save the reference from a copy of the script that is known to be good:
//   MHN_SCRIPT=<good copy> node check.mjs --save-layout
// The reference depends on the fonts of this computer, so it stays in results/.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser, open, HN, downloaded } from './lib.mjs';

const args = process.argv.slice(2);
const SAVE = args.includes('--save-layout');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const RESULTS = fileURLToPath(new URL('results/', import.meta.url));
const LONG = `${HN}/item?copies=30`;

let failed = 0;
let passed = 0;
const ok = (name, pass, detail = '') => {
	if (pass) passed++;
	else failed++;
	if (!pass || detail) console.log(pass ? 'PASS' : 'FAIL', name, detail);
};
const gmKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('gm:')).sort());
const fontsReady = (page) => page.waitForFunction(() => document.fonts.size > 0 && [...document.fonts].every((font) => font.status === 'loaded'), null, { timeout: 30000 });
const family = (page, selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily.split(',')[0], selector);
const status = (page, id) => page.evaluate((i) => document.querySelector(`#${i}`).closest('div:has(.mhn-status)').querySelector('.mhn-status').textContent, id);
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mhn-prefs') || '{}'));
const setPrefs = (page, prefs) => page.evaluate((value) => localStorage.setItem('mhn-prefs', JSON.stringify(value)), prefs);

const CHECKS = {
	async fonts() {
		const page = await open(1280, { height: 900 });
		await page.goto(`${HN}/front?day=2026-11-17`);
		await page.click('[popovertarget="mhn-settings"]');
		await page.selectOption('#mhn-heading', 'geist-serif');
		ok('status shows the download', (await status(page, 'mhn-heading')).includes('progress'));
		await fontsReady(page);
		await page.waitForTimeout(500);
		ok('heading is Geist Serif', await family(page, '.titleline > a') === 'mhn-geist-serif' && await family(page, '.mhn-date h1') === 'mhn-geist-serif');
		ok('text stays', await family(page, 'body') === 'Inter');
		ok('status clears', await status(page, 'mhn-heading') === '');
		await page.selectOption('#mhn-font', 'allo');
		await page.waitForFunction(() => [...document.fonts].some((font) => font.family === 'mhn-allo' && font.status === 'loaded'), null, { timeout: 30000 });
		await page.waitForTimeout(500);
		ok('text is Allo', await family(page, 'body') === 'mhn-allo');
		ok('roundness slider shows', await page.evaluate(() => !document.querySelector('#mhn-round').closest('div:not(.mhn-slider-head)').hidden));
		ok('one key for each font', JSON.stringify(await gmKeys(page)) === JSON.stringify(['gm:mhn-font:allo', 'gm:mhn-font:geist-serif']), JSON.stringify(await gmKeys(page)));
		ok('prefs saved after the delay', (await saved(page)).font === 'allo' && (await saved(page)).heading === 'geist-serif');
		const before = downloaded().length;
		await page.reload();
		await fontsReady(page);
		ok('reload uses the saved fonts', downloaded().length === before && await family(page, 'body') === 'mhn-allo');
		await page.click('[popovertarget="mhn-settings"]');
		await page.selectOption('#mhn-heading', 'same');
		await page.waitForTimeout(500);
		ok('heading follows the text', await family(page, '.titleline > a') === 'mhn-allo' && !(await page.evaluate(() => document.documentElement.hasAttribute('data-mhn-heading'))));
		ok('unused font is removed', JSON.stringify(await gmKeys(page)) === JSON.stringify(['gm:mhn-font:allo']), JSON.stringify(await gmKeys(page)));
		ok('"same" stays after a reload', (await saved(page)).heading === 'same');
		// The save waits: a change is not in storage at once, but a page hide saves it.
		await page.selectOption('#mhn-font', 'system-serif');
		const early = (await saved(page)).font;
		await page.reload();
		ok('save waits, then page hide saves', early === 'allo' && (await saved(page)).font === 'system-serif', early);
		await page.context().close();

		for (const [name, old] of [['1.6', { id: 'bitter', files: [] }], ['1.7', { bitter: [] }]]) {
			const other = await open(1280);
			await other.goto(`${HN}/item`);
			await other.evaluate((value) => {
				localStorage.clear();
				localStorage.setItem('mhn-prefs', JSON.stringify({ font: 'bitter' }));
				localStorage.setItem('gm:mhn-font', JSON.stringify(value));
			}, old);
			const count = downloaded().length;
			await other.reload();
			await other.waitForTimeout(400);
			ok(`font saved by version ${name} loads with no download`, downloaded().length === count && (await gmKeys(other)).includes('gm:mhn-font:bitter'), JSON.stringify(await gmKeys(other)));
			await other.context().close();
		}
	},

	async fold() {
		const page = await open(1280, { height: 900 });
		const requests = [];
		page.on('request', (request) => {
			if (request.url().includes('collapse')) requests.push(request.url());
		});
		await page.goto(`${HN}/item`);
		const counts = () => page.evaluate(() => {
			const by = {};
			for (const row of document.querySelectorAll('tr.comtr')) {
				const depth = Number(row.querySelector('td.ind').getAttribute('indent')) || 0;
				by[depth] ??= [0, 0];
				if (row.classList.contains('coll')) by[depth][0]++;
				if (row.classList.contains('noshow')) by[depth][1]++;
			}
			return JSON.stringify(by);
		});
		const expected = { '-1': '{"0":[1,0],"1":[0,1],"2":[0,0],"3":[0,0]}', 0: '{"0":[11,0],"1":[0,15],"2":[0,4],"3":[0,1]}', 1: '{"0":[1,0],"1":[14,1],"2":[0,4],"3":[0,1]}', 2: '{"0":[1,0],"1":[0,1],"2":[4,0],"3":[0,1]}' };
		for (const fold of [-1, 0, 1, 2]) {
			await setPrefs(page, { fold });
			await page.reload();
			await page.waitForTimeout(300);
			ok(`fold ${fold}`, await counts() === expected[fold], await counts());
		}
		ok('start fold sends nothing to the server', requests.length === 0);
		await page.evaluate(() => [...document.querySelectorAll('tr.comtr.coll')].find((row) => row.querySelector('a.togg').getAttribute('n') !== '1').querySelector('a.togg').click());
		await page.waitForTimeout(100);
		ok('a click opens a folded comment', await page.evaluate(() => document.querySelectorAll('tr.comtr:not(.coll) a.togg[aria-expanded="false"]').length === 0) && requests.length === 1);
		await page.click('[popovertarget="mhn-settings"]');
		ok('fold select shows the value', await page.evaluate(() => document.querySelector('#mhn-fold').value) === '2');
		await page.selectOption('#mhn-fold', '-1');

		const headerState = () => page.evaluate(() => [getComputedStyle(document.querySelector('.mhn-header')).position, getComputedStyle(document.documentElement).scrollPaddingTop, document.querySelector('.mhn-header').offsetHeight]);
		const pinned = await headerState();
		await page.evaluate(() => document.querySelector('#mhn-settings [name="pin"]').click());
		const free = await headerState();
		ok('pinned header setting', pinned[0] === 'sticky' && pinned[1] === `${pinned[2] + 16}px` && free[0] === 'static' && free[1] === '16px', JSON.stringify([pinned, free]));
		await page.keyboard.press('Escape');
		await page.evaluate(() => scrollTo(0, 600));
		await page.waitForTimeout(100);
		ok('free header scrolls away', await page.evaluate(() => document.querySelector('.mhn-header').getBoundingClientRect().bottom < 0));
		await page.keyboard.press('j');
		await page.waitForTimeout(600);
		ok('jump lands at the top with a free header', await page.evaluate(() => [...document.querySelectorAll('tr.comtr')].filter((row) => row.querySelector('td.ind[indent="0"]')).some((row) => Math.abs(row.querySelector('.comhead').getBoundingClientRect().top - 16) < 3)));

		// A fold with the gutter and with the comment head, on an open page.
		await setPrefs(page, {});
		await page.reload();
		await page.waitForTimeout(300);
		const parent = await page.evaluate(() => [...document.querySelectorAll('tr.comtr')].find((row) => Number(row.querySelector('a.togg').getAttribute('n')) > 2).id);
		const state = () => page.evaluate((id) => {
			const row = document.getElementById(id);
			return [row.classList.contains('coll'), row.nextElementSibling.classList.contains('noshow'), row.querySelector('a.togg').getAttribute('aria-expanded')].join();
		}, parent);
		await page.evaluate((id) => document.getElementById(id).querySelector('td.default > div').click(), parent);
		await page.waitForTimeout(100);
		ok('a click on the comment head folds the thread', await state() === 'true,true,false', await state());
		const hidden = await page.evaluate((id) => {
			const reply = document.getElementById(id).nextElementSibling;
			const text = reply.querySelector('.commtext');
			const words = text.textContent.trim().slice(0, 40);
			getSelection().removeAllRanges();
			return { height: reply.offsetHeight, visible: text.checkVisibility(), found: window.find(words), link: reply.querySelector('a[href^="user"]').checkVisibility() };
		}, parent);
		ok('a folded reply takes no space and is out of reach', hidden.height === 0 && !hidden.visible && !hidden.found && !hidden.link, JSON.stringify(hidden));
		await page.keyboard.press('Tab');
		ok('focus does not go into a folded reply', await page.evaluate(() => {
			// Tab through the page: no link in a hidden comment gets the focus.
			return !document.activeElement.closest('tr.comtr.noshow');
		}));
		await page.evaluate((id) => document.getElementById(id).querySelector('td.default > div').click(), parent);
		await page.waitForTimeout(100);
		ok('a second click opens it', await state() === 'false,false,true', await state());
		await page.context().close();
	},

	async jump() {
		const page = await open(1280, { height: 900 });
		await page.goto(LONG);
		await page.waitForTimeout(500);
		ok('the long thread has 961 comments with their own ids', await page.evaluate(() => document.querySelectorAll('tr.comtr').length === 961 && new Set([...document.querySelectorAll('tr.comtr')].map((row) => row.id)).size === 961));
		const line = await page.evaluate(() => document.querySelector('.mhn-header').getBoundingClientRect().bottom + 16);
		// The offset of the thread head that is nearest to the line under the header.
		const offset = () => page.evaluate((y) => [...document.querySelectorAll('tr.comtr')].filter((row) => row.querySelector('td.ind[indent="0"]')).map((row) => row.querySelector('.comhead').getBoundingClientRect().top).reduce((best, top) => (Math.abs(top - y) < Math.abs(best - y) ? top : best), 1e9) - y, line);
		// The index of the root thread at the line, to see that each jump moves one thread.
		const index = () => page.evaluate((y) => [...document.querySelectorAll('tr.comtr')].filter((row) => row.querySelector('td.ind[indent="0"]')).findIndex((row) => Math.abs(row.querySelector('.comhead').getBoundingClientRect().top - y) < 3), line);
		let worst = 0;
		let steps = [];
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press('j');
			await page.waitForTimeout(350);
			worst = Math.max(worst, Math.abs(await offset()));
			steps.push(await index());
		}
		ok('25 jumps down land on a thread head', worst < 3, `worst offset ${worst.toFixed(1)} px`);
		ok('each jump down moves one thread', steps.every((at, i) => at === i), steps.join(' '));
		worst = 0;
		steps = [];
		for (let i = 0; i < 10; i++) {
			await page.keyboard.press('k');
			await page.waitForTimeout(350);
			worst = Math.max(worst, Math.abs(await offset()));
			steps.push(await index());
		}
		ok('10 jumps up land on a thread head', worst < 3, `worst offset ${worst.toFixed(1)} px`);
		ok('each jump up moves one thread', steps.every((at, i) => at === 23 - i), steps.join(' '));
		worst = 0;
		for (let i = 0; i < 8; i++) {
			await page.evaluate(() => document.querySelector('[data-mhn-jump="next"]').click());
			await page.waitForTimeout(1000);
			worst = Math.max(worst, Math.abs(await offset()));
		}
		ok('8 animated jumps land on a thread head', worst < 3, `worst offset ${worst.toFixed(1)} px`);

		// From the middle of the page, where the comments above are not laid out.
		await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight * 0.6));
		await page.waitForTimeout(300);
		const before = await page.evaluate(() => scrollY);
		await page.keyboard.press('j');
		await page.waitForTimeout(350);
		const down = await page.evaluate(() => scrollY);
		ok('a jump down from the middle lands on the next head', Math.abs(await offset()) < 3 && down > before && down - before < 3000, `moved ${Math.round(down - before)} px`);
		await page.keyboard.press('k');
		await page.waitForTimeout(350);
		await page.keyboard.press('k');
		await page.waitForTimeout(350);
		const up = await page.evaluate(() => scrollY);
		ok('jumps up from the middle land on a head above', Math.abs(await offset()) < 3 && up < down && down - up < 6000, `moved ${Math.round(down - up)} px`);

		await page.evaluate(() => document.querySelector('[data-mhn-jump="bottom"]').click());
		await page.waitForTimeout(1200);
		ok('bottom button reaches the end', await page.evaluate(() => Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) < 3));
		await page.keyboard.press('k');
		await page.waitForTimeout(350);
		ok('a jump up from the end lands on a thread head', Math.abs(await offset()) < 3);
		await page.evaluate(() => document.querySelector('[data-mhn-jump="top"]').click());
		await page.waitForTimeout(1200);
		ok('top button reaches the start', await page.evaluate(() => scrollY) === 0);

		const far = await page.evaluate(() => [...document.querySelectorAll('tr.comtr')][700].id);
		await page.evaluate((id) => document.getElementById(id).scrollIntoView(), far);
		await page.waitForTimeout(400);
		const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, far);
		ok('a far comment scrolls into view below the header', top > 40 && top < 140, `top ${Math.round(top)}`);
		ok('find in page reaches skipped text', await page.evaluate(() => {
			scrollTo(0, 0);
			return window.find('It never really was');
		}));
		await page.context().close();
	},

	async filter() {
		const page = await open(1280, { height: 900 });
		await page.goto(`${HN}/item`);
		await page.waitForTimeout(300);
		ok('selection colours reach the comment text', await page.evaluate(() => {
			const colour = (selector) => getComputedStyle(document.querySelector(selector), '::selection').backgroundColor;
			return colour('.commtext') === colour('html') && colour('.commtext') !== 'rgba(0, 0, 0, 0)' && colour('.commtext') !== getComputedStyle(document.body).backgroundColor && colour('.mhn-tabs a') === colour('html');
		}));
		await page.keyboard.press('/');
		await page.evaluate(() => document.querySelector('input[name="mhn-search-scope"][value="page"]').click());
		await page.keyboard.type('matrix');
		await page.waitForTimeout(200);
		const shown = () => page.evaluate(() => [[...document.querySelectorAll('tr.comtr')].filter((row) => row.offsetHeight > 0).length, document.querySelector('.mhn-search-status').textContent, CSS.highlights.get('mhn-find')?.size || 0]);
		const [rows, count, ranges] = await shown();
		ok('the filter hides comments without the word', rows > 0 && rows < 31 && count === `${rows} of 31`, `${rows} rows, "${count}"`);
		ok('the filter marks the matches', ranges > 0, `${ranges} ranges`);
		await page.screenshot({ path: fileURLToPath(new URL('results/filter.png', import.meta.url)) });
		ok('the highlight has its colours', await page.evaluate(() => {
			const row = [...document.querySelectorAll('tr.comtr')].find((r) => r.offsetHeight > 0);
			const style = getComputedStyle(row.querySelector('.commtext'), '::highlight(mhn-find)');
			return style.backgroundColor !== 'rgba(0, 0, 0, 0)';
		}));
		// A jump must not go to a comment that the filter hides.
		await page.keyboard.press('Tab');
		await page.evaluate(() => document.activeElement.blur());
		const at = await page.evaluate(() => scrollY);
		await page.keyboard.press('k');
		await page.waitForTimeout(300);
		ok('K at the top with a filter does not move the page', await page.evaluate(() => scrollY) === at);
		await page.evaluate(() => {
			const field = document.querySelector('.mhn-search input[role="searchbox"]');
			field.value = '';
			field.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(200);
		const after = await shown();
		ok('a cleared filter shows all comments again', after[0] === 30 && after[1] === '' && after[2] === 0, JSON.stringify(after));
		await page.context().close();
	},

	async pages() {
		for (const path of ['/', '/item', '/front?day=2026-11-17', '/newcomments', '/threads?id=dang', '/user?id=pg', '/jobs', '/login']) {
			const page = await open(1280, { height: 900, quiet: true });
			await page.goto(`${HN}${path}`);
			await page.waitForTimeout(300);
			ok(`no errors on ${path}`, page.errors.length === 0, page.errors.join(' | ').slice(0, 200));
			if (path === '/login') {
				ok('the login page has the narrow column', await page.evaluate(() => getComputedStyle(document.body).maxWidth !== 'none' && parseFloat(getComputedStyle(document.body).paddingTop) > 30));
			} else if (path !== '/user?id=pg') {
				// The fixture of the user page has no footer.
				ok(`footer of ${path}`, await page.evaluate(() => {
					const row = document.querySelector('.yclinks').closest('#hnmain > tbody > tr');
					const hidden = [...row.querySelectorAll(':scope > td > img, :scope > td > table, :scope > td > br, center br')].every((node) => getComputedStyle(node).display === 'none');
					return hidden && getComputedStyle(row).textAlign === 'center' && parseFloat(getComputedStyle(row).borderTopWidth) === 1 && getComputedStyle(document.body).maxWidth === 'none';
				}));
			}
			if (path === '/threads?id=dang') {
				ok('threads rows skip when off screen', await page.evaluate(() => {
					const style = getComputedStyle(document.querySelector('tr.comtr'));
					return style.display === 'block' && style.contentVisibility === 'auto';
				}));
				ok('jump buttons sit at the bottom on the threads page', await page.evaluate(() => document.querySelector('.mhn-jump').getBoundingClientRect().top > innerHeight / 2));
			}
			await page.context().close();
		}
		const page = await open(1280, { height: 900 });
		await page.goto(`${HN}/`);
		const before = await page.evaluate(() => document.querySelectorAll('tr.athing').length);
		await page.click('a.morelink');
		await page.waitForFunction((count) => document.querySelectorAll('tr.athing').length > count, before);
		ok('"More" adds stories with their meta rows', await page.evaluate(() => document.querySelectorAll('tr.athing').length === 60 && document.querySelectorAll('td.subtext:not(.mhn-done)').length === 0));
		await page.context().close();
	},

	// The box of each element, at two widths, against the saved reference.
	async layout() {
		const boxes = (page) => page.evaluate(async () => {
			// Bring each part of the page into view once, so each comment has its real size.
			for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
				scrollTo(0, y);
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
			scrollTo(0, 0);
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const half = (value) => Math.round(value * 2) / 2;
			// The title span is left out. It is an inline box around the title
			// link, and its height comes from the first font of the list that
			// is ready at that moment, which differs from load to load. The
			// link inside it and the cell around it are both in the list.
			return [...document.querySelectorAll('body *')].filter((node) => !node.closest('svg, [popover], select') && !node.matches('span.titleline')).map((node) => {
				// A hidden comment has no box, or a box with no height that the
				// browser skips. Both count as "no box"; a hidden comment that
				// takes space moves the comments after it, and those are in the list.
				const rect = node.closest('tr.comtr.noshow, tr.comtr.mhn-filtered') ? { x: 0, y: 0, width: 0, height: 0 } : node.getBoundingClientRect();
				return `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 24)} ${half(rect.x)},${half(rect.y)} ${half(rect.width)}x${half(rect.height)}`;
			});
		});
		mkdirSync(RESULTS, { recursive: true });
		for (const width of [1280, 390]) {
			for (const [name, path, prefs] of [['front', '/'], ['story', '/item'], ['past', '/front?day=2026-11-17'], ['newcomments', '/newcomments'], ['threads', '/threads?id=dang'], ['user', '/user?id=pg'], ['login', '/login'], ['story-votes', '/item', { votes: true }], ['story-folded', '/item', { fold: 1 }], ['front-votes', '/', { votes: true }]]) {
				const page = await open(width, { height: 900, quiet: true });
				await page.goto(`${HN}/login`);
				await setPrefs(page, prefs || {});
				await page.goto(`${HN}${path}`);
				await page.waitForTimeout(300);
				const now = await boxes(page);
				const file = `${RESULTS}layout_${name}_${width}.json`;
				if (SAVE) {
					writeFileSync(file, JSON.stringify(now));
				} else if (!existsSync(file)) {
					ok(`layout of ${name} at ${width} px`, false, 'no reference: run with --save-layout first');
				} else {
					const before = JSON.parse(readFileSync(file, 'utf8'));
					const changed = now.map((box, i) => (box === before[i] ? null : `${before[i]} -> ${box}`)).filter(Boolean);
					ok(`layout of ${name} at ${width} px`, changed.length === 0 && now.length === before.length, changed.length ? `${changed.length} of ${now.length} boxes differ: ${changed.slice(0, 3).join(' | ')}` : '');
				}
				await page.context().close();
			}
		}
		if (SAVE) console.log('layout reference saved');
	},
};

for (const [name, check] of Object.entries(CHECKS)) {
	if (SAVE ? name !== 'layout' : ONLY && !ONLY.includes(name)) continue;
	try {
		await check();
	} catch (error) {
		ok(`${name} ran to the end`, false, error.message.split('\n')[0]);
	}
}
await browser.close();
if (!SAVE) console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
