import { chromium, firefox } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

export const HN = 'https://news.ycombinator.com';
// MHN_SCRIPT names another copy of the userscript, to compare two versions.
export const SCRIPT_PATH = process.env.MHN_SCRIPT || here('../modern-hn.user.js');
const script = readFileSync(SCRIPT_PATH, 'utf8');

const FIXTURES = {
	'/': 'hn_front.html', '/news': 'hn_front.html', '/item': 'hn_item.html', '/front': 'hn_past.html', '/newcomments': 'hn_newcomments.html',
	'/user': 'hn_user_id_pg.html', '/threads': 'hn_threads_id_dang.html', '/login': 'hn_login.html', '/jobs': 'hn_jobs.html', '/news.css': 'news.css', '/hn.js': 'hn.js',
};
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript' };
const fixture = (file) => readFileSync(here(`fixtures/${file}`), 'utf8');

// The policy that the live site sends; it decides whether a font can load.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://cdnjs.cloudflare.com/; frame-src 'self' https://www.google.com/recaptcha/; style-src 'self' 'unsafe-inline'; img-src 'self' https://account.ycombinator.com; frame-ancestors 'self'";

// A code block that is wider than the reading column.
const WIDE_BLOCK = `<pre><code>  +-------------------------------+--------------+--------+--------+----------+-------+
  |              Lab              |      XL      |   L    |   M+   |    M     | S/XS  |
  | Northwind (Quartz 5.5 Family) |              | Large  |        | Medium   | Small |
  +-------------------------------+--------------+--------+--------+----------+-------+
</code></pre>`;

// Stand-ins for the functions of the userscript manager.
const GM_SHIM = `
window.GM_getValue = (key) => { const raw = localStorage.getItem('gm:' + key); return raw ? JSON.parse(raw) : undefined; };
window.GM_setValue = (key, value) => localStorage.setItem('gm:' + key, JSON.stringify(value));
window.GM_deleteValue = (key) => localStorage.removeItem('gm:' + key);
window.GM_listValues = () => Object.keys(localStorage).filter((key) => key.startsWith('gm:')).map((key) => key.slice(3));
window.GM_xmlhttpRequest = ({ url, responseType, onload, onerror }) => window.__download(url).then((result) => {
	if (!result) return onerror();
	const binary = atob(result.data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	if (responseType === 'json') {
		const text = new TextDecoder().decode(bytes);
		let json = null;
		try { json = JSON.parse(text); } catch {}
		return onload({ status: result.status, response: json, responseText: text });
	}
	onload({ status: result.status, response: bytes.buffer });
});
`;

// The story page has 31 comments. "?copies=30" gives the same page with the
// comments 31 times, each copy with its own ids: a thread of 961 comments.
function longThread(body, copies) {
	const open = '<table border="0" class="comment-tree">';
	const start = body.indexOf(open) + open.length;
	const end = body.indexOf('</table><br><br>', start);
	const rows = body.slice(start, end);
	let all = rows;
	for (let copy = 1; copy <= copies; copy++) all += rows.replace(/\b50(\d{6})\b/g, (id, rest) => `${50 + copy}${rest}`);
	return body.slice(0, start) + all + body.slice(end);
}

function pageBody(url, signedIn) {
	const file = FIXTURES[url.pathname];
	let body = fixture(file);
	if (!file.endsWith('.html')) return body;
	// A second page of stories for the "More" link: other stories, ranks 31 to 60.
	if (url.searchParams.get('p') === '2') body = fixture('hn_past.html').replace(/<span class="rank">(\d+)\.<\/span>/g, (m, n) => `<span class="rank">${+n + 30}.</span>`);
	if (signedIn) {
		body = body
			.replace(/<a href="login\?goto=[^"]*">login<\/a>/, `<a id='me' href="user?id=testuser">testuser</a>&nbsp;(1234)&nbsp;|&nbsp;<a id='logout' rel='nofollow' href="logout?auth=x&amp;goto=news">logout</a>`)
			.replace('<a href="newest">new</a> | ', '<a href="newest">new</a> | <a href="threads?id=testuser">threads</a> | ');
	}
	body = body.replace(/<div class="commtext c00">/, (m) => `${m}A table:${WIDE_BLOCK}<p>`);
	const copies = Number(url.searchParams.get('copies'));
	if (copies) body = longThread(body, copies);
	return body;
}

// MHN_NO_AX=1 turns the accessibility tree of the browser off. A reader with
// no assistive technology has it off; on this computer it can be on.
// MHN_BROWSER=firefox runs the Playwright build of Firefox ("npx playwright-core
// install firefox" gets it). The checks run in it; the timing tools need Chrome.
export const FIREFOX = process.env.MHN_BROWSER === 'firefox';
export const browser = FIREFOX
	? await firefox.launch()
	: await chromium.launch({ channel: 'chrome', args: process.env.MHN_NO_AX ? ['--disable-renderer-accessibility'] : [] });
const downloads = [];
export const downloaded = () => downloads;

export async function open(width, { signedIn = true, height = 800, colorScheme = 'dark', userscript = true, quiet = false } = {}) {
	const context = await browser.newContext({ viewport: { width, height }, colorScheme });
	await context.exposeFunction('__download', async (url) => {
		downloads.push(url);
		if (process.env.OFFLINE && url.includes('algolia')) return null;
		try {
			const response = await fetch(url);
			return { status: response.status, data: Buffer.from(await response.arrayBuffer()).toString('base64') };
		} catch {
			return null;
		}
	});
	await context.addInitScript({ content: GM_SHIM });
	if (userscript) await context.addInitScript({ content: script });
	const page = await context.newPage();
	page.errors = [];
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		page.errors.push(message.text());
		if (!quiet) console.log('console error', message.text().slice(0, 200));
	});
	page.on('pageerror', (error) => {
		page.errors.push(error.message);
		if (!quiet) console.log('pageerror', error.message);
	});
	await page.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname !== 'news.ycombinator.com' || !FIXTURES[url.pathname]) return route.fulfill({ status: 204, body: '' });
		const type = TYPES[FIXTURES[url.pathname].split('.').pop()];
		return route.fulfill({ contentType: type, body: pageBody(url, signedIn), headers: { 'Content-Security-Policy': CSP } });
	});
	return page;
}

// The first page of a new browser can lay out text before the fonts of this
// computer are ready, and its boxes then differ from all later pages. One
// page that no test reads takes that state away.
{
	const page = await open(1280, { quiet: true });
	await page.goto(`${HN}/`);
	await page.waitForTimeout(300);
	await page.context().close();
}
