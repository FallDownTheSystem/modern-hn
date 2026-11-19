// ==UserScript==
// @name         Modern HN
// @namespace    modern-hn
// @author       FallDownTheSystem
// @license      MIT
// @homepageURL  https://github.com/FallDownTheSystem/modern-hn
// @supportURL   https://github.com/FallDownTheSystem/modern-hn/issues
// @downloadURL  https://raw.githubusercontent.com/FallDownTheSystem/modern-hn/main/modern-hn.user.js
// @updateURL    https://raw.githubusercontent.com/FallDownTheSystem/modern-hn/main/modern-hn.user.js
// @version      1.8.0
// @description  Modern reading layout for Hacker News with thread folding, comment jumping, a calendar for past front pages, search by date, a page filter, and theme, font and text size settings.
// @match        https://news.ycombinator.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      cdn.jsdelivr.net
// @connect      hn.algolia.com
// ==/UserScript==

/* global GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues */

(() => {
	'use strict';

	const MAX_DEPTH = 60;
	const FIRST_DAY = '2006-10-09';
	const NAV_WORDS = new Set(['root', 'parent', 'prev', 'next', 'context']);

	// Everything is nested in `:root:root` so each rule outranks news.css, which
	// loads after this style element and would otherwise win every specificity tie.
	//
	// Units: content is sized in rem and follows the reader's text size. The
	// header, the floating panels and the jump buttons are sized in px, so they
	// stay still while the reader changes the text size.
	const HIGHLIGHT_COLOURS = 'background-color: var(--mhn-accent-subtle); color: var(--mhn-text-primary);';
	const css = String.raw`
:root:root {
	/* Every colour is a light-dark() pair, so the theme is one switch: color-scheme. */
	color-scheme: dark;
	&[data-mhn-theme="light"] { color-scheme: light; }
	&[data-mhn-theme="system"] { color-scheme: light dark; }

	/* The four theme controls. The script overwrites them with the reader's values.
	   d: darkness 0..1, k: contrast 0..1, h: hue of the neutrals, t: tint 0..1. */
	--mhn-d: 0.5;
	--mhn-k: 0.5;
	--mhn-h: 60;
	--mhn-t: 0.25;

	/* Chroma of the neutrals. A light surface shows a tint more strongly than a
	   dark one, so the light scheme gets half. */
	--mhn-c-bg: calc(0.018 * var(--mhn-t));
	--mhn-c-bg-light: calc(0.009 * var(--mhn-t));
	--mhn-c-fg: calc(0.022 * var(--mhn-t));
	/* Lightness of the page in the dark and in the light scheme. Contrast acts
	   on every step: it moves the page away from the text, moves each text
	   step away from the page, and makes the borders and surfaces stronger.
	   Each formula gives the same value at k = 0.5 as the fixed palette had. */
	--mhn-ld: calc(0.24 - 0.14 * var(--mhn-d) - 0.05 * (var(--mhn-k) - 0.5));
	--mhn-ll: min(0.995, 1.005 - 0.07 * var(--mhn-d) + 0.03 * (var(--mhn-k) - 0.5));

	--mhn-bg-page: light-dark(
		oklch(var(--mhn-ll) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(var(--mhn-ld) var(--mhn-c-bg) var(--mhn-h)));
	--mhn-bg-surface: light-dark(
		oklch(min(0.998, var(--mhn-ll) + 0.02) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.025 + 0.03 * var(--mhn-k)) var(--mhn-c-bg) var(--mhn-h)));
	--mhn-bg-raised: light-dark(
		oklch(calc(var(--mhn-ll) - 0.02 - 0.03 * var(--mhn-k)) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.05 + 0.06 * var(--mhn-k)) var(--mhn-c-bg) var(--mhn-h)));
	--mhn-bg-hover: light-dark(
		oklch(calc(var(--mhn-ll) - 0.04 - 0.06 * var(--mhn-k)) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.085 + 0.08 * var(--mhn-k)) var(--mhn-c-bg) var(--mhn-h)));
	--mhn-bg-selected: light-dark(
		oklch(min(0.998, var(--mhn-ll) + 0.02) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.085 + 0.08 * var(--mhn-k)) var(--mhn-c-bg) var(--mhn-h)));
	--mhn-border-subtle: light-dark(
		oklch(0 0 0 / calc(0.03 + 0.12 * var(--mhn-k))),
		oklch(1 0 0 / calc(0.03 + 0.10 * var(--mhn-k))));
	--mhn-border: light-dark(
		oklch(0 0 0 / calc(0.06 + 0.20 * var(--mhn-k))),
		oklch(1 0 0 / calc(0.05 + 0.18 * var(--mhn-k))));
	--mhn-border-strong: light-dark(
		oklch(0 0 0 / calc(0.12 + 0.32 * var(--mhn-k))),
		oklch(1 0 0 / calc(0.10 + 0.28 * var(--mhn-k))));
	--mhn-thread-line: light-dark(
		oklch(calc(var(--mhn-ll) - 0.09 - 0.13 * var(--mhn-k)) var(--mhn-c-bg-light) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.15 + 0.17 * var(--mhn-k)) var(--mhn-c-bg) var(--mhn-h)));
	/* The min() and max() limits keep each text step above 4.5:1 against the
	   page at every setting of lightness and contrast. That limit is why the
	   low end of the contrast range is shorter than the high end. */
	--mhn-text-primary: light-dark(
		oklch(max(0.05, var(--mhn-ll) - 0.55 - 0.40 * var(--mhn-k)) var(--mhn-c-fg) var(--mhn-h)),
		oklch(min(1, var(--mhn-ld) + 0.56 + 0.40 * var(--mhn-k)) var(--mhn-c-fg) var(--mhn-h)));
	--mhn-text-secondary: light-dark(
		oklch(calc(var(--mhn-ll) - max(0.50, 0.42 + 0.30 * var(--mhn-k))) var(--mhn-c-fg) var(--mhn-h)),
		oklch(max(0.66, var(--mhn-ld) + 0.44 + 0.31 * var(--mhn-k)) var(--mhn-c-fg) var(--mhn-h)));
	--mhn-text-tertiary: light-dark(
		oklch(calc(var(--mhn-ll) - max(0.435, 0.39 + 0.16 * var(--mhn-k))) var(--mhn-c-fg) var(--mhn-h)),
		oklch(max(0.62, var(--mhn-ld) + 0.41 + 0.17 * var(--mhn-k)) var(--mhn-c-fg) var(--mhn-h)));
	--mhn-text-disabled: light-dark(
		oklch(calc(var(--mhn-ll) - 0.29) var(--mhn-c-fg) var(--mhn-h)),
		oklch(calc(var(--mhn-ld) + 0.31) var(--mhn-c-fg) var(--mhn-h)));
	--mhn-accent-text: light-dark(oklch(0.520 0.160 45), oklch(0.770 0.155 55));
	--mhn-accent-solid: light-dark(oklch(0.680 0.185 48), oklch(0.720 0.180 50));
	--mhn-accent-solid-hover: light-dark(oklch(0.630 0.185 46), oklch(0.780 0.160 55));
	--mhn-accent-subtle: light-dark(oklch(0.900 0.060 60), oklch(0.330 0.070 52));
	--mhn-on-accent: oklch(0.180 0.020 50);
	--mhn-new-user: light-dark(oklch(0.480 0.140 145), oklch(0.790 0.150 145));
	--mhn-focus: light-dark(oklch(0.250 0.006 60), oklch(0.900 0.004 60));
	--mhn-shadow: light-dark(oklch(0 0 0 / 0.14), oklch(0 0 0 / 0.5));

	--mhn-sans: Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif;
	--mhn-serif: Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif;
	--mhn-mono-system: ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace;
	--mhn-mono: var(--mhn-mono-system);
	/* The script sets --mhn-font-pick to the family that the reader chose. The
	   stack behind it has the same kind, so a font that loads late moves little. */
	--mhn-font-base: var(--mhn-sans);
	&[data-mhn-font="serif"] { --mhn-font-base: var(--mhn-serif); }
	&[data-mhn-font="mono"] {
		--mhn-font-base: var(--mhn-mono-system);
		--mhn-mono: var(--mhn-font-pick, ui-monospace), var(--mhn-mono-system);
	}
	--mhn-font: var(--mhn-font-pick, var(--mhn-font-base)), var(--mhn-font-base);
	/* Headings use the text font until the reader chooses a heading font. */
	--mhn-heading-base: var(--mhn-sans);
	&[data-mhn-heading="serif"] { --mhn-heading-base: var(--mhn-serif); }
	&[data-mhn-heading="mono"] { --mhn-heading-base: var(--mhn-mono-system); }
	--mhn-heading: var(--mhn-font);
	&[data-mhn-heading] { --mhn-heading: var(--mhn-heading-pick, var(--mhn-heading-base)), var(--mhn-heading-base); }

	/* Radius rule: icon buttons are round, floating panels use --mhn-radius-lg,
	   every other control and surface uses --mhn-radius. */
	--mhn-radius: 8px;
	--mhn-radius-lg: 12px;
	/* --mhn-w is the reader's page width, 1 by default. */
	--mhn-col: calc(40rem * var(--mhn-w, 1));
	/* Caps a comment at about 75 characters a line at the default page width;
	   deeper replies keep that width until the column runs out. */
	--mhn-measure: calc(var(--mhn-col) * 0.8);
	--mhn-indent: 24px;
	--mhn-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
	--mhn-press: transform 160ms var(--mhn-ease-out);
	--mhn-tint: color 120ms ease, background-color 120ms ease;

	& {
		/* 16 is the size of comment text in pixels. */
		font-size: calc(var(--mhn-size, 16) / 16 * 100%);
		background: var(--mhn-bg-page);
		accent-color: var(--mhn-accent-solid);
		scrollbar-color: var(--mhn-border-strong) var(--mhn-bg-page);
		/* The space for the pinned header. The script replaces this with the
		   measured height. It writes this property and not a variable: a
		   new value of a variable on the root element makes the browser
		   style the page again. */
		scroll-padding-block-start: calc(57px + 1rem);
		text-wrap: pretty;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		-webkit-text-size-adjust: 100%;
	}

	@media (max-width: 48rem) {
		& { --mhn-indent: 16px; }
	}

	/* The roundness axis of a font has no CSS property. The rule names every
	   element because a "font" shorthand sets the axes of its element back. */
	&[data-mhn-round] * { font-variation-settings: "ROND" var(--mhn-round, 50); }

	[hidden] { display: none !important; }
	.noshow { display: none !important; }
	.nosee { visibility: hidden; pointer-events: none; }

	/* The colours of selected text, and of the matches of the page filter, are
	   rules on the root element alone, and they pass down the tree. A rule
	   for all elements makes the browser compute one more style for each
	   element on each style pass. */
	&::selection { ${HIGHLIGHT_COLOURS} }

	body {
		margin: 0;
		background: var(--mhn-bg-page) !important;
		color: var(--mhn-text-secondary);
		/* --mhn-weight is the reader's weight for running text. Titles and names
		   are set relative to it, so the steps between them stay. */
		font: var(--mhn-weight, 400) 0.875rem/1.5 var(--mhn-font);
	}

	/* Pages without the main table: login, the guidelines, error messages.
	   Each :has() in this file names the full path to its target with child
	   combinators. The browser then looks at a few elements. With a plain
	   :has(#hnmain) it walks every element of the page on each style pass,
	   which is most of the cost of a setting change on a long thread. */
	body:not(:has(> center > #hnmain)) {
		box-sizing: border-box;
		max-width: calc(var(--mhn-col) + 2rem);
		margin-inline: auto;
		padding: 3rem 1rem 6rem;
		font-size: 1rem;
		line-height: 1.6;
	}
	body:not(:has(> center > #hnmain)) b { color: var(--mhn-text-primary); }
	body:not(:has(> center > #hnmain)) td { padding-block: 0.25rem; padding-inline-end: 0.75rem; }
	body:not(:has(> center > #hnmain)) table[width] { width: 100%; }
	body:not(:has(> center > #hnmain)) form table {
		width: 100%;
		max-width: 24rem;
	}
	body:not(:has(> center > #hnmain)) form td:first-child { width: 1%; white-space: nowrap; }
	body:not(:has(> center > #hnmain)) form td:last-child { padding-inline-end: 0; }
	body:not(:has(> center > #hnmain)) form td input { width: 100%; }
	body:not(:has(> center > #hnmain)) form + a { display: inline-block; margin-block-start: 1rem; }

	/* The page is in quirks mode, where tables do not inherit font or colour. */
	table {
		border-spacing: 0;
		color: inherit;
		font: inherit;
		text-align: start;
	}
	td, th {
		padding: 0;
		color: inherit;
		font: inherit;
	}
	[bgcolor] { background-color: transparent !important; }
	center { text-align: inherit; }
	font { font-size: inherit; }
	font[color="#afafaf" i], font[color="#ffffff" i] { color: inherit; }
	font[color="#3c963c" i] { color: var(--mhn-new-user); }
	img[src="s.gif"] { display: block; }

	.default, .title, .subtext, .comhead, .comment, .pagetop, .yclinks, .admin, .admin td {
		font-family: var(--mhn-font);
	}
	.titleline > a, .mhn-results h1, .mhn-hit-title, .mhn-date h1 {
		font-family: var(--mhn-heading);
	}

	a:link, a:visited {
		color: var(--mhn-text-primary);
		text-decoration: none;
	}
	a:visited { color: var(--mhn-text-secondary); }
	u > a, a > u { text-decoration: underline; text-underline-offset: 0.15em; }

	:focus-visible {
		outline: 2px solid var(--mhn-focus);
		outline-offset: 2px;
		border-radius: 4px;
	}
	a, button, input[type="submit"] { touch-action: manipulation; }

	.mhn-icon {
		/* A click must land on the control: hn.js reads className as a string
		   and throws on an SVG element. */
		pointer-events: none;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mhn-icon * { vector-effect: non-scaling-stroke; }

	/* ---------- Page frame ---------- */

	#hnmain,
	#hnmain > tbody,
	#hnmain > tbody > tr,
	#hnmain > tbody > tr > td {
		display: block;
	}
	#hnmain {
		isolation: isolate;
		box-sizing: content-box;
		width: auto !important;
		min-width: 0;
		max-width: var(--mhn-col);
		margin-inline: auto;
		padding: 2.5rem 1rem 2rem;
		text-align: start;
	}
	#hnmain > tbody > tr:not([class]):not([id]):empty { display: none; }
	#hnmain .mhn-native-header { display: none; }
	#bigbox > td > br { display: none; }
	#bigbox > td > table:has(> tbody > tr.submission),
	table.comment-tree,
	tr.comtr > td > table {
		width: 100%;
	}

	/* ---------- Header ---------- */

	.mhn-header {
		position: sticky;
		inset-block-start: 0;
		z-index: 20;
		container-type: inline-size;
		background: var(--mhn-bg-page);
		border-block-end: 1px solid var(--mhn-border-subtle);
		font-size: 14px;
		font-weight: 400;
		line-height: 1.5;
		text-wrap: nowrap;
	}
	.mhn-header-inner {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: stretch;
		min-height: 56px;
		padding-inline: 16px;
	}
	/* With room to spare, the tabs start at the left edge of the reading column
	   and the day control ends at its right edge. A side track never gets
	   narrower than its content. A small text size makes the column narrower
	   than the tabs and the day control together, so the middle track has a
	   floor of 640px and its content stays on one row. */
	@container (min-width: 1240px) {
		.mhn-header-inner {
			grid-template-columns: minmax(max-content, 1fr) minmax(0, max(var(--mhn-col), 640px)) minmax(max-content, 1fr);
		}
		.mhn-mid { flex-wrap: nowrap; }
		.mhn-account { justify-self: end; }
	}
	.mhn-skip {
		position: absolute;
		inset-inline-start: -999px;
		inset-block-start: 8px;
		z-index: 30;
		padding: 8px 12px;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
	}
	.mhn-skip:focus { inset-inline-start: 16px; }
	.mhn-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-self: start;
		padding-inline-end: 24px;
		font-size: 16px;
		font-weight: 600;
		white-space: nowrap;
	}
	.mhn-brand:visited { color: var(--mhn-text-primary); }
	.mhn-brand img {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		border: 0 !important;
		border-radius: 4px;
	}
	.mhn-mid {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		column-gap: 16px;
		min-width: 0;
	}
	.mhn-tabs { min-width: 0; }
	/* The tabs wrap when they do not fit, so no tab hides past a scroll edge. */
	.mhn-tabs ul {
		--mhn-tab-pad: 12px;
		display: flex;
		flex-wrap: wrap;
		margin: 0;
		margin-inline-start: calc(var(--mhn-tab-pad) * -1);
		padding: 0;
		list-style: none;
	}
	.mhn-tabs a {
		position: relative;
		display: flex;
		align-items: center;
		height: 56px;
		padding-inline: var(--mhn-tab-pad);
		color: var(--mhn-text-secondary);
		font-weight: 500;
		white-space: nowrap;
		text-transform: capitalize;
		transition: var(--mhn-tint);
	}
	.mhn-tabs a[aria-current="page"] { color: var(--mhn-text-primary); }
	.mhn-tabs a[aria-current="page"]::after {
		content: "";
		position: absolute;
		inset-inline: var(--mhn-tab-pad);
		inset-block-end: 0;
		height: 2px;
		background: var(--mhn-accent-solid);
	}
	.mhn-tabs a:focus-visible { outline-offset: -2px; }
	.mhn-account {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		padding-inline-start: 24px;
		white-space: nowrap;
	}
	.mhn-account a {
		padding: 6px 8px;
		border-radius: var(--mhn-radius);
		color: var(--mhn-text-secondary);
		font-weight: 500;
		text-transform: capitalize;
		transition: var(--mhn-tint);
	}
	.mhn-account a#me {
		color: var(--mhn-text-primary);
		text-transform: none;
	}
	.mhn-karma {
		margin-inline: -4px 4px;
		color: var(--mhn-text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.mhn-account > * { flex-shrink: 0; }
	/* A long user name shortens before anything in the row wraps. */
	.mhn-account a#me {
		flex-shrink: 1;
		min-width: 3ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mhn-tools {
		display: flex;
		gap: 8px;
		margin-inline-start: 8px;
	}
	.mhn-set-logout { display: none; }

	/* The day control: previous day, the day that the page shows, next day. */
	.mhn-day {
		display: flex;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
		box-shadow: 0 0 0 1px var(--mhn-border-subtle);
	}
	.mhn-day > * {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 36px;
		height: 36px;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: var(--mhn-radius);
		background: transparent;
		color: var(--mhn-text-secondary);
		cursor: pointer;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	.mhn-day > a:visited { color: var(--mhn-text-secondary); }
	.mhn-day > :focus-visible { border-radius: var(--mhn-radius); }
	.mhn-day > [aria-disabled="true"] {
		color: var(--mhn-text-disabled);
		cursor: default;
	}
	.mhn-day > :not([aria-disabled="true"]):active { transform: scale(0.97); }
	.mhn-day-pill {
		gap: 8px;
		padding-inline: 10px 12px;
		font: 500 14px/20px var(--mhn-font);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.mhn-day-pill .mhn-icon {
		width: 16px;
		height: 16px;
	}
	.mhn-day-pill[data-past], .mhn-day-pill[aria-expanded="true"] { color: var(--mhn-text-primary); }
	.mhn-day-pill[aria-expanded="true"] { background: var(--mhn-bg-hover); }

	/* Below the three-track layout, the tabs and the day control take a row of
	   their own: one row cannot hold them and the account links. */
	@container (max-width: 1239.98px) {
		.mhn-header-inner {
			grid-template-columns: auto minmax(0, 1fr);
			grid-template-rows: auto auto;
		}
		.mhn-mid {
			grid-row: 2;
			grid-column: 1 / -1;
			padding-block-end: 4px;
		}
		.mhn-tabs a { height: 44px; }
		.mhn-account {
			grid-row: 1;
			grid-column: 2;
			min-width: 0;
			min-height: 56px;
			padding-inline-start: 8px;
		}
	}
	/* On a phone the tabs fill one row and the day control fills the next.
	   A header of three rows is too tall to pin; it scrolls with the page.
	   The account row stays on one line: the logout link moves into the
	   settings panel, and the karma and the site name hide. The site name
	   stays for screen readers. These are media queries and not container
	   queries, because the header cannot query itself and the settings panel
	   is outside the header. */
	/* The reader can set the header to scroll with the page. The script writes
	   the space for the header on the root element; this rule outranks it. */
	&[data-mhn-unpinned] {
		scroll-padding-block-start: 1rem !important;
		.mhn-header { position: static; }
	}
	@media (max-width: 640px) {
		.mhn-header { position: static; }
		.mhn-tabs { flex: 1 1 100%; }
		.mhn-tabs ul {
			--mhn-tab-pad: 6px;
			justify-content: space-between;
		}
		.mhn-day {
			flex: 1 1 100%;
			margin-block: 4px 8px;
		}
		.mhn-day-pill { flex: 1; }
		.mhn-account a { padding-inline: 6px; }
		.mhn-karma, .mhn-account a#logout { display: none; }
		.mhn-set-logout {
			display: inline-flex;
			margin-inline-start: 8px;
		}
		.mhn-brand { min-width: 24px; padding-inline-end: 0; }
		.mhn-brand span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* ---------- Story list ---------- */

	tr.athing.submission > td { vertical-align: baseline; }
	tr.athing.submission > td.title:first-child {
		width: 1.75rem;
		min-width: 1.75rem;
		padding-inline-end: 0.5rem;
		text-align: end;
		white-space: nowrap;
	}
	/* The vote cell keeps its place with no width: the row below spans it. */
	tr.athing.submission > td:nth-child(2) {
		width: 0;
		min-width: 0;
	}
	tr.athing.submission > td.title:last-child { width: 100%; }
	.rank {
		color: var(--mhn-text-tertiary);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
	.title { overflow: visible; }
	.titleline {
		font-size: 1rem;
		line-height: 1.4;
	}
	.titleline > a {
		padding-block: 0.125rem;
		font-weight: calc(var(--mhn-weight, 400) + 100);
		overflow-wrap: anywhere;
	}
	.titleline > .sitebit {
		color: var(--mhn-text-tertiary);
		font-size: 0.8125rem;
	}
	.titleline > .sitebit a { color: inherit; }
	tr.spacer { height: 1.125rem !important; }
	tr.morespace { height: 1.5rem !important; }

	td.subtext {
		padding-block-start: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.4;
	}
	.subline, td.subtext { color: var(--mhn-text-secondary); }
	.subtext a:link, .subtext a:visited,
	.comhead a:link, .comhead a:visited {
		color: inherit;
	}

	.mhn-meta {
		display: flex;
		align-items: center;
		min-width: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	/* Every item has a separator in front of it. The row starts one separator
	   width to the left and clips that strip, so no line begins with a dot. */
	.mhn-items {
		--mhn-sep: 1.25em;
		display: flex;
		flex: 0 1 auto;
		flex-wrap: wrap;
		align-items: center;
		min-width: 0;
		margin-inline-start: calc(var(--mhn-sep) * -1);
		clip-path: inset(-0.5rem -0.5rem -0.5rem calc(var(--mhn-sep) - 3px));
	}
	/* 1.5rem rows give every link in a meta row a 24px target. */
	.mhn-item {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		min-height: 1.5rem;
	}
	.mhn-item a, .mhn-navs a, .reply a {
		display: inline-block;
		line-height: 1.5rem;
	}
	.mhn-sep {
		flex-shrink: 0;
		width: var(--mhn-sep);
		color: var(--mhn-text-tertiary);
		text-align: center;
		user-select: none;
	}
	tr.comtr:not(.coll) span.comhead > .mhn-items { flex: 1 1 auto; }
	/* hn.js fills this span with " | unvote" after a vote; the pipe must stay hidden. */
	.mhn-meta [id^="unv_"] { font-size: 0; }
	.mhn-meta [id^="unv_"] a { font-size: 0.8125rem; }
	.mhn-item:has(> [id^="unv_"]:empty) { display: none; }
	.mhn-meta a.mhn-site:link, .mhn-meta a.mhn-site:visited { color: var(--mhn-accent-text); }
	.mhn-meta .score, .mhn-meta .age { font-variant-numeric: tabular-nums; }
	.mhn-pair {
		display: inline-flex;
		/* The note and the link have different line heights; the baseline
		   keeps their text on one line. */
		align-items: baseline;
		gap: 0.35em;
		min-width: 0;
	}
	.mhn-pair a {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* On a wide screen a long story title shortens instead of pushing the row onto two lines. */
	@media (min-width: 48.0625rem) {
		.mhn-items:has(> .mhn-item > .mhn-pair) { flex-wrap: nowrap; }
		.mhn-items:has(> .mhn-item > .mhn-pair) > .mhn-item:not(:has(> .mhn-pair)),
		.mhn-items:has(> .mhn-item > .mhn-pair) > .mhn-navs {
			flex-shrink: 0;
			white-space: nowrap;
		}
	}

	a.morelink {
		display: inline-flex;
		padding: 0.5rem 1rem;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
		box-shadow: 0 0 0 1px var(--mhn-border-subtle);
		color: var(--mhn-text-primary);
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.25rem;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	a.morelink:visited { color: var(--mhn-text-primary); }
	a.morelink:active { transform: scale(0.97); }

	/* ---------- Vote arrows ---------- */

	/* The arrows are hidden unless the reader turns them on. In a comment, the
	   empty cell is the gutter that holds the fold control and the thread line. */
	.votelinks {
		width: var(--mhn-indent);
		min-width: var(--mhn-indent);
	}
	.votelinks > * { display: none; }

	&[data-mhn-votes] {
		.votelinks > * { display: block; }
		.votelinks a {
			position: relative;
			display: grid;
			place-items: center;
			height: 1.5rem;
			margin: 0;
			color: var(--mhn-text-tertiary);
			transition: var(--mhn-tint);
		}
		.votelinks a::after {
			content: "";
			position: absolute;
			inset: 0 -4px;
		}
		.votearrow {
			width: 12px;
			height: 10px;
			margin: 0;
			background: currentColor !important;
			clip-path: polygon(50% 0, 100% 100%, 0 100%);
			transform: none;
		}
		.votearrow.rotate180 { transform: rotate(180deg); }
		/* In a story row the arrow sits in a box as tall as the first line of
		   the title and at the top of the row, so it centres on that line. */
		tr.athing.submission > td:nth-child(2) {
			width: var(--mhn-indent);
			min-width: var(--mhn-indent);
			vertical-align: top;
		}
		tr.athing.submission .votelinks a { height: 1.4rem; }
		/* A story list grows into the page margin by the width of the arrow
		   column, so the titles keep the same start and width. */
		#bigbox > td > table:has(> tbody > tr.submission):not(.fatitem) {
			width: calc(100% + var(--mhn-indent));
			margin-inline-start: calc(var(--mhn-indent) * -1);
		}
		.fatitem > tbody > tr > td[colspan="2"],
		.fatitem > tbody > tr > td.votelinks {
			display: block;
			flex: 0 0 var(--mhn-indent);
			/* The arrow hangs in the page margin, so the title keeps the
			   same start and width with the arrows on or off. */
			margin-inline-start: calc(var(--mhn-indent) * -1);
		}
		.fatitem tr.athing.submission .votelinks a { height: 2.3rem; }
		/* The arrow takes the gutter, so the fold control goes back next to the username. */
		tr.comtr a.togg { margin-inline: -0.375rem 0.125rem; }
	}

	/* ---------- Story page ---------- */

	/* The native rows have 3 columns in one row and 2 in the next; flex rows
	   give every row one content column. */
	table.fatitem, .fatitem > tbody {
		display: block;
	}
	table.fatitem {
		margin-block-end: 0.5rem;
		padding-block-end: 2rem;
		border-block-end: 1px solid var(--mhn-border-subtle);
	}
	.fatitem > tbody > tr { display: flex; }
	.fatitem > tbody > tr > td { display: block; }
	.fatitem > tbody > tr > td:last-child {
		flex: 1;
		width: auto;
		min-width: 0;
	}
	.fatitem > tbody > tr > td[colspan="2"],
	.fatitem > tbody > tr > td.votelinks {
		display: none;
	}
	.fatitem tr.athing.submission > td.title:first-child { display: none; }
	.fatitem .titleline {
		display: block;
		font-size: 2rem;
		line-height: 1.15;
	}
	.fatitem .titleline > a {
		font-weight: calc(var(--mhn-weight, 400) + 200);
		letter-spacing: -0.02em;
	}
	.fatitem .titleline > a:visited { color: var(--mhn-text-primary); }
	.fatitem td.subtext { padding-block-start: 0.75rem; }
	.fatitem tr[style*="height"] { height: 0 !important; }
	.toptext {
		padding-block-start: 1.25rem;
		color: var(--mhn-text-primary);
		font-size: 1rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.toptext { max-width: var(--mhn-measure); }
	.toptext:empty { display: none; }
	.mhn-label {
		display: block;
		margin-block-end: 0.375rem;
		color: var(--mhn-text-secondary);
		font-size: 0.8125rem;
	}
	.toptext p { margin: 1em 0 0; }
	.fatitem form { margin: 1.5rem 0 0; }
	.fatitem form br { display: none; }
	.fatitem form textarea { margin-block-end: 0.75rem; }
	.fatitem form input[type="submit"] { display: block; }
	.fatitem form a[href="formatdoc"] {
		float: inline-end;
		color: var(--mhn-text-tertiary);
		font-size: 0.8125rem;
	}

	/* ---------- Comments ---------- */

	tr.comtr > td > table > tbody > tr > td,
	tr.athing:not(.submission) > td {
		vertical-align: top;
	}
	td.ind {
		--mhn-half: calc(var(--mhn-indent) / 2);
		background-image: repeating-linear-gradient(
			to right,
			transparent 0 calc(var(--mhn-half) - 1px),
			var(--mhn-thread-line) calc(var(--mhn-half) - 1px) calc(var(--mhn-half) + 1px),
			transparent calc(var(--mhn-half) + 1px) var(--mhn-indent)
		);
		cursor: pointer;
	}
	/* Fixed layout: the column widths come from these rules, so a long word or
	   a long title cannot push a comment wider than the page. */
	tr.comtr > td > table,
	table.comment-tree,
	&[op="newcomments"] #bigbox > td > table {
		table-layout: fixed;
		width: 100%;
	}
	/* The browser does not style, lay out or paint a comment that is far from
	   the view. A change of a setting then costs the same on a long thread as
	   on a short one. A table row cannot skip its content, so the rows are
	   blocks; the table has one column, so the layout stays the same. The
	   rows of the "threads" page are blocks already. */
	table.comment-tree,
	table.comment-tree > tbody,
	table.comment-tree > tbody > tr,
	table.comment-tree > tbody > tr > td {
		display: block;
	}
	tr.comtr {
		content-visibility: auto;
		contain-intrinsic-block-size: auto 8rem;
		/* A wide code block grows out of the column, and the skip rule clips
		   a row at its edges. The margin keeps that part of the block in view. */
		overflow-clip-margin: 100vw;
	}
	/* A comment that a fold or the page filter hides stays a box with no
	   height, and the browser skips its content. With "display: none", a
	   browser with its accessibility tree on reads each element of each
	   hidden comment: 150 ms on a thread of 961 comments that starts folded. */
	@supports (content-visibility: hidden) {
		tr.comtr.noshow, tr.comtr.mhn-filtered {
			display: block !important;
			content-visibility: hidden;
			contain-intrinsic-block-size: 0px;
			height: 0;
		}
	}
	td.ind { width: calc(var(--mhn-depth, 0) * var(--mhn-indent)); }
	td.ind img {
		width: 100%;
		height: 1px;
	}
	td.ind ~ td { padding-block-start: var(--mhn-gap, 0.875rem); }
	td.ind[indent="0"] ~ td { --mhn-gap: 2rem; }
	.comment-tree > tbody > tr:first-child td.ind[indent="0"] ~ td { --mhn-gap: 1.5rem; }
	.fatitem td.ind ~ td { --mhn-gap: 0; }

	/* The line under a comment's own fold control, drawn only when the comment has replies. */
	tr.comtr:not(.coll):has(a.togg:not([n="1"])) td.votelinks {
		background: linear-gradient(var(--mhn-thread-line), var(--mhn-thread-line)) no-repeat;
		background-position: calc(var(--mhn-indent) / 2 - 1px) calc(var(--mhn-gap, 0.875rem) + 1.75rem);
		background-size: 2px 100%;
		cursor: pointer;
	}
	/* The hovered thread line takes one of six hues, by depth, so the reader
	   can see which level a click folds. */
	.mhn-thread-hot {
		position: absolute;
		z-index: 1;
		width: 2px;
		border-radius: 1px;
		background: light-dark(oklch(0.60 0.17 var(--mhn-hot, 50)), oklch(0.78 0.14 var(--mhn-hot, 50)));
		pointer-events: none;
	}

	td.default {
		padding-inline: 0.25rem 0;
		border-radius: var(--mhn-radius);
	}
	td.default > div { max-width: var(--mhn-measure); }
	td.default > div:first-child { margin: 0 !important; }
	td.default > br { display: none; }
	tr.comtr td.default > div:first-child { cursor: pointer; }

	span.comhead:not(.sitebit) {
		align-items: flex-start;
		min-height: 1.5rem;
		color: var(--mhn-text-secondary);
		font-size: 0.8125rem;
	}
	.comhead a[href^="user?id="] {
		color: var(--mhn-text-primary);
		font-size: 0.875rem;
		font-weight: calc(var(--mhn-weight, 400) + 200);
	}
	.comhead a[href^="user?id="]:has(font[color="#3c963c" i]) { color: var(--mhn-new-user); }
	.mhn-navs {
		display: inline-flex;
		gap: 0.75rem;
		margin-inline-start: auto;
		padding-inline-start: 1rem;
		color: var(--mhn-text-tertiary);
	}

	a.togg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		margin-inline: -0.375rem 0.125rem;
		border-radius: var(--mhn-radius);
		color: var(--mhn-text-tertiary);
		font-size: 0;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	a.togg:link, a.togg:visited { color: var(--mhn-text-tertiary); }
	/* The fold control sits in the gutter, centred on the thread line below it.
	   The end margin puts the username on the left edge of the comment text. */
	tr.comtr a.togg {
		margin-inline-start: calc(-1rem - var(--mhn-indent) / 2);
		margin-inline-end: calc(var(--mhn-indent) / 2 - 0.5rem);
	}
	a.togg::before {
		content: "";
		width: 6px;
		height: 6px;
		border: solid currentColor;
		border-width: 0 2px 2px 0;
		transform: translateY(-2px) rotate(45deg);
	}
	.coll a.togg::before { transform: translateX(-2px) rotate(-45deg); }
	a.togg:active { transform: scale(0.97); }
	.coll span.comhead[data-mhn-replies]::after {
		content: attr(data-mhn-replies);
		/* The row aligns its parts to the top, for meta text that wraps. The
		   pill is one line, so it centres on the row. */
		align-self: center;
		margin-inline-start: 0.75rem;
		padding: 0 0.5rem;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
		color: var(--mhn-text-secondary);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.coll .comhead a[href^="user?id="] { color: var(--mhn-text-secondary); }
	.coll .mhn-navs { display: none; }

	.comment {
		max-width: none;
		padding-block-start: 0.25rem;
		overflow: visible;
		color: var(--mhn-text-primary);
		font-size: 1rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.commtext, .commtext.c00 { color: var(--mhn-text-primary); }
	/* Hacker News fades a downvoted comment in nine steps. The steps stay, but
	   the faintest one still passes 4.5:1 against the page. */
	.commtext.c5a { color: color-mix(in oklch, var(--mhn-text-primary) 92%, var(--mhn-bg-page)); }
	.commtext.c73 { color: color-mix(in oklch, var(--mhn-text-primary) 87%, var(--mhn-bg-page)); }
	.commtext.c82 { color: color-mix(in oklch, var(--mhn-text-primary) 82%, var(--mhn-bg-page)); }
	.commtext.c88 { color: color-mix(in oklch, var(--mhn-text-primary) 78%, var(--mhn-bg-page)); }
	.commtext.c9c { color: color-mix(in oklch, var(--mhn-text-primary) 74%, var(--mhn-bg-page)); }
	.commtext.cae { color: color-mix(in oklch, var(--mhn-text-primary) 70%, var(--mhn-bg-page)); }
	.commtext.cbe { color: color-mix(in oklch, var(--mhn-text-primary) 66%, var(--mhn-bg-page)); }
	.commtext.cce { color: color-mix(in oklch, var(--mhn-text-primary) 63%, var(--mhn-bg-page)); }
	.commtext.cdd { color: color-mix(in oklch, var(--mhn-text-primary) 60%, var(--mhn-bg-page)); }
	.commtext p, .default p { margin: 1em 0 0; }
	:is(.commtext, .toptext, .mhn-hit-text) a:is(:link, :visited) {
		display: inline;
		max-width: none;
		color: var(--mhn-accent-text);
		text-decoration: underline;
		text-decoration-thickness: from-font;
		text-underline-offset: 0.15em;
		white-space: normal;
	}
	:is(.commtext, .toptext, .mhn-hit-text) a:visited {
		color: color-mix(in oklch, var(--mhn-accent-text) 70%, var(--mhn-text-secondary));
	}
	/* Preformatted text is never wrapped: a wrapped ASCII table is unreadable.
	   The block leaves the reading measure and grows to the right, as far as
	   1rem from the edge of the window; only then does it scroll. 100cqi is
	   the width of #hnmain. */
	#hnmain { container-type: inline-size; }
	pre {
		box-sizing: border-box;
		width: max-content;
		max-width: calc(100cqi - (var(--mhn-depth, 0) + 1) * var(--mhn-indent) - 0.25rem + max(0px, (100vw - 100cqi) / 2 - 2rem));
		margin: 1em 0 0;
		padding: 0;
		overflow-x: auto;
		font: 0.875rem/1.4 var(--mhn-mono);
		white-space: pre;
	}
	code { font-family: var(--mhn-mono); }
	.reply {
		margin-block-start: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.reply:empty { display: none; }
	.reply p { margin: 0; }
	.reply u { text-decoration: none; }
	.reply a:link, .reply a:visited {
		color: var(--mhn-text-tertiary);
		font-weight: 500;
		text-decoration: none;
	}

	/* ---------- Forms ---------- */

	input, textarea, select { font-family: var(--mhn-font); }
	input:not([type]), input[type="text"], input[type="password"], input[type="url"],
	input[type="email"], input[type="number"], textarea, select {
		box-sizing: border-box;
		max-width: 100%;
		padding: 0.5rem 0.625rem;
		border: 0;
		border-radius: var(--mhn-radius);
		background-color: var(--mhn-bg-surface);
		box-shadow: 0 0 0 1px var(--mhn-border);
		color: var(--mhn-text-primary);
		caret-color: var(--mhn-accent-text);
		font-size: 0.875rem;
		line-height: 1.5;
	}
	textarea {
		display: block;
		width: 100%;
		font-size: 1rem;
		resize: vertical;
	}
	input:focus-visible, textarea:focus-visible, select:focus-visible {
		outline: 2px solid var(--mhn-focus);
		outline-offset: -1px;
		border-radius: var(--mhn-radius);
	}
	input[readonly] {
		background: transparent;
		box-shadow: none;
		color: var(--mhn-text-secondary);
	}
	::placeholder { color: var(--mhn-text-tertiary); opacity: 1; }
	@media (pointer: coarse) {
		/* iOS zooms the page when a focused field has text below 16px. */
		input, textarea, select { font-size: max(1rem, 16px); }
	}
	input[type="submit"], input[type="button"], button:not([class]) {
		padding: 0.5rem 1rem;
		border: 0;
		border-radius: var(--mhn-radius);
		background: var(--mhn-accent-solid);
		color: var(--mhn-on-accent);
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25rem;
		cursor: pointer;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	input[type="submit"]:not(:disabled):active { transform: scale(0.97); }

	/* A native form is a table with the label in the first cell of a row.
	   The rows get space between them, and the label text sits on the line
	   of the first line of text in the field. */
	#hnmain tr:has(> td > :is(input:not([type="hidden"], [type="submit"]), textarea, select)) > td {
		padding-block: 0.375rem;
		vertical-align: top;
	}
	#hnmain tr:has(> td > :is(input:not([type="hidden"], [type="submit"]), textarea, select)) > td:first-child {
		padding-block-start: 0.875rem;
		padding-inline-end: 1rem;
		color: var(--mhn-text-tertiary);
		font-size: 0.875rem;
		line-height: 1.3125rem;
		white-space: nowrap;
	}
	#hnmain tr:has(> td > textarea) > td:first-child { line-height: 1.5rem; }
	#hnmain td > input[type="submit"] { margin-block: 0.5rem; }
	/* A field has a fixed width from its "size" attribute, which can be wider
	   than a phone. With a width in percent the field can get narrower. */
	@media (max-width: 640px) {
		#hnmain table:has(> tbody > tr > td > :is(input:not([type="hidden"], [type="submit"]), textarea)) { width: 100%; }
		#hnmain td > :is(input:not([type="hidden"], [type="submit"], [type="checkbox"], [type="radio"]), textarea) { width: 100%; }
	}

	/* ---------- Other pages ---------- */

	#bigbox > td > div:not([class]) {
		margin: 0 0 1.5rem !important;
		line-height: 1.6;
	}
	&[op="user"] #bigbox td,
	&[op="leaders"] #bigbox td,
	&[op="lists"] #bigbox td {
		padding-block: 0.25rem;
		padding-inline-end: 1rem;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	/* The native "about" cell clips its content, which cuts off the outline of a field in it. */
	&[op="user"] #bigbox td { overflow: visible !important; }
	&[op="user"] #bigbox td:first-child { color: var(--mhn-text-tertiary); white-space: nowrap; }
	&[op="user"] #bigbox a { display: inline-block; line-height: 1.5rem; }

	/* ---------- Footer ---------- */

	#hnmain > tbody > tr:has(> td > center > .yclinks) {
		margin-block-start: 2.5rem;
		padding-block-start: 1.25rem;
		border-block-start: 1px solid var(--mhn-border-subtle);
		color: var(--mhn-text-tertiary);
		font-size: 0.8125rem;
		text-align: center;
		& > td > img, & > td > table, & > td > br, & center br { display: none; }
	}
	.yclinks {
		justify-content: center;
		color: var(--mhn-text-tertiary);
	}
	.yclinks a:link, .yclinks a:visited { color: var(--mhn-text-tertiary); }
	/* The search bar in the header replaces the native search form. */
	#hnmain form[action*="algolia"] { display: none; }

	/* ---------- Search bar (in the header, sized in px) ---------- */

	.mhn-search {
		display: grid;
		gap: 8px;
		box-sizing: border-box;
		max-width: calc(max(var(--mhn-col), 640px) + 32px);
		margin-inline: auto;
		/* The space above keeps the field clear of the underline of the current tab. */
		padding: 8px 16px 12px;
	}
	.mhn-search-main, .mhn-search-options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.mhn-search-field {
		position: relative;
		flex: 1 1 240px;
		min-width: 0;
		color: var(--mhn-text-tertiary);
	}
	.mhn-search-field .mhn-icon {
		position: absolute;
		inset-inline-start: 10px;
		inset-block-start: 10px;
		width: 16px;
		height: 16px;
	}
	/* The field shares its size rule with the fields of the panels. This rule
	   adds room for the icon at the start and for the count at the end. */
	.mhn-search .mhn-search-field input[type="text"] { padding-inline: 34px 96px; }
	.mhn-search .mhn-seg { display: inline-grid; }
	.mhn-search .mhn-seg label { padding-inline: 12px; }
	.mhn-search .mhn-select { width: 152px; }
	/* On a phone the sort switch and the time list share a row, and the kind
	   switch fills the next one. */
	@media (max-width: 640px) {
		.mhn-search .mhn-select {
			flex: 1 1 120px;
			width: auto;
			order: 1;
		}
		.mhn-search-options .mhn-seg:nth-of-type(2) {
			display: grid;
			flex: 1 1 100%;
			order: 2;
		}
	}
	/* The count of the page filter sits inside the field, at its end, so it
	   needs no row of its own. */
	.mhn-search-status {
		position: absolute;
		inset-inline-end: 10px;
		inset-block-start: 0;
		margin: 0;
		color: var(--mhn-text-secondary);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		line-height: 36px;
		pointer-events: none;
	}

	/* ---------- Page filter and search results ---------- */

	.mhn-filtered { display: none !important; }
	/* On the root element alone, as the selection colours are. */
	&::highlight(mhn-find) { ${HIGHLIGHT_COLOURS} }
	mark {
		border-radius: 2px;
		background: var(--mhn-accent-subtle);
		color: inherit;
	}
	/* While results show, they take the place of the page content. */
	&[data-mhn-search] #bigbox > td > :not(.mhn-results) { display: none !important; }
	.mhn-results-head {
		margin-block-end: 2rem;
		padding-block-end: 1.5rem;
		border-block-end: 1px solid var(--mhn-border-subtle);
	}
	.mhn-results h1 {
		margin: 0;
		color: var(--mhn-text-primary);
		font-size: 2rem;
		font-weight: calc(var(--mhn-weight, 400) + 200);
		line-height: 1.15;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.mhn-results-status {
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
	}
	.mhn-hits {
		display: grid;
		/* minmax(0, ...) lets a long title shorten; a plain track grows to fit it. */
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
		transition: opacity 120ms ease-out;
	}
	/* The old results stay in place while new ones load, so the page does not jump. */
	.mhn-results[aria-busy="true"] .mhn-hits { opacity: 0.5; }
	.mhn-hit-title {
		font-size: 1rem;
		font-weight: calc(var(--mhn-weight, 400) + 100);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.mhn-hit .mhn-meta { margin-block-start: 0.125rem; }
	.mhn-hit-text {
		display: -webkit-box;
		max-width: var(--mhn-measure);
		margin-block-start: 0.25rem;
		overflow: hidden;
		color: var(--mhn-text-primary);
		font-size: 1rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
	}
	.mhn-hit-text p { margin: 0.75em 0 0; }
	.mhn-hit-text pre { max-width: 100%; }
	.mhn-results > .mhn-btn { margin-block-start: 2rem; }

	/* ---------- Heading of the "past" page ---------- */

	.mhn-date {
		margin-block-end: 2rem;
		padding-block-end: 1.75rem;
		border-block-end: 1px solid var(--mhn-border-subtle);
	}
	.mhn-date h1 {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.75rem;
		margin: 0;
		color: var(--mhn-text-primary);
		font-size: 2.25rem;
		font-weight: calc(var(--mhn-weight, 400) + 200);
		line-height: 1.15;
		letter-spacing: -0.02em;
	}
	.mhn-date-rest {
		color: var(--mhn-text-secondary);
		font-size: 1.5rem;
		font-weight: 400;
		letter-spacing: 0;
	}

	/* ---------- Round icon buttons ---------- */

	.mhn-icon-btn {
		position: relative;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--mhn-bg-raised);
		box-shadow: 0 0 0 1px var(--mhn-border-subtle);
		color: var(--mhn-text-secondary);
		cursor: pointer;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	.mhn-icon-btn:focus-visible { border-radius: 50%; }
	.mhn-icon-btn:not([aria-disabled="true"]):active { transform: scale(0.97); }
	.mhn-icon-btn[aria-disabled="true"] {
		background: transparent;
		box-shadow: none;
		color: var(--mhn-text-disabled);
		cursor: default;
	}
	.mhn-icon-btn[aria-expanded="true"] {
		background: var(--mhn-bg-hover);
		color: var(--mhn-text-primary);
	}

	/* ---------- Floating panels: calendar and display settings ---------- */

	.mhn-pop {
		position: fixed;
		inset: auto;
		inset-block-start: var(--mhn-pop-top, 56px);
		left: var(--mhn-pop-left, 8px);
		box-sizing: border-box;
		width: var(--mhn-pop-width);
		max-width: calc(100vw - 16px);
		max-height: calc(100dvh - var(--mhn-pop-top, 56px) - 8px);
		margin: 0;
		padding: 16px;
		overflow: auto;
		overscroll-behavior: contain;
		border: 0;
		border-radius: var(--mhn-radius-lg);
		background: var(--mhn-bg-surface);
		box-shadow: 0 0 0 1px var(--mhn-border), 0 12px 32px var(--mhn-shadow);
		color: var(--mhn-text-secondary);
		font: 400 14px/1.5 var(--mhn-font);
		transform-origin: top center;
		transition: opacity 120ms ease-out, transform 150ms var(--mhn-ease-out);
	}
	.mhn-pop:popover-open {
		display: grid;
		gap: 16px;
	}
	@starting-style {
		.mhn-pop:popover-open {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
	}
	.mhn-pop fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.mhn-pop legend, .mhn-pop .mhn-label {
		margin-block-end: 6px;
		padding: 0;
		color: var(--mhn-text-secondary);
		font-size: 13px;
	}
	:is(.mhn-pop, .mhn-search) input:not([type="radio"], [type="range"], [type="checkbox"]), :is(.mhn-pop, .mhn-search) select {
		width: 100%;
		height: 36px;
		padding: 0 10px;
		font-size: 14px;
	}
	@media (pointer: coarse) {
		:is(.mhn-pop, .mhn-search) input:not([type="radio"], [type="range"], [type="checkbox"]), :is(.mhn-pop, .mhn-search) select { font-size: 16px; }
	}
	/* The browser draws its own arrow at the very edge of a list. This arrow
	   has the inset of the text on the other side. */
	.mhn-select {
		position: relative;
		display: block;
	}
	.mhn-select select {
		appearance: none;
		padding-inline-end: 32px;
		cursor: pointer;
	}
	.mhn-select::after {
		content: "";
		position: absolute;
		inset-inline-end: 13px;
		inset-block-start: 50%;
		width: 6px;
		height: 6px;
		border: solid var(--mhn-text-tertiary);
		border-width: 0 2px 2px 0;
		transform: translateY(-70%) rotate(45deg);
		pointer-events: none;
	}
	.mhn-switch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 24px;
		font-size: 13px;
		cursor: pointer;
	}
	.mhn-switch input {
		appearance: none;
		position: relative;
		flex-shrink: 0;
		width: 36px;
		height: 20px;
		margin: 0;
		border-radius: 10px;
		background: var(--mhn-bg-hover);
		box-shadow: inset 0 0 0 1px var(--mhn-border);
		cursor: pointer;
		transition: var(--mhn-tint);
	}
	.mhn-switch input::after {
		content: "";
		position: absolute;
		inset-block-start: 2px;
		inset-inline-start: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--mhn-text-secondary);
		transition: transform 160ms var(--mhn-ease-out), background-color 120ms ease;
	}
	.mhn-switch input:checked {
		background: var(--mhn-accent-solid);
		box-shadow: none;
	}
	.mhn-switch input:checked::after {
		background: var(--mhn-on-accent);
		transform: translateX(16px);
	}
	.mhn-switch input:focus-visible {
		outline: 2px solid var(--mhn-focus);
		outline-offset: 2px;
		border-radius: 10px;
	}
	.mhn-pop-title {
		margin: 0;
		color: var(--mhn-text-primary);
		font-size: 14px;
		font-weight: 600;
	}
	.mhn-group {
		display: grid;
		gap: 12px;
	}
	.mhn-group + .mhn-group {
		padding-block-start: 16px;
		border-block-start: 1px solid var(--mhn-border-subtle);
	}

	.mhn-seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 2px;
		padding: 2px;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-page);
		box-shadow: 0 0 0 1px var(--mhn-border-subtle);
	}
	.mhn-seg label {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 32px;
		/* Inner radius = outer radius - the 2px padding of the track. */
		border-radius: calc(var(--mhn-radius) - 2px);
		color: var(--mhn-text-secondary);
		font-size: 13px;
		font-weight: 500;
		transition: var(--mhn-tint);
	}
	.mhn-seg input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.mhn-seg label:has(:checked) {
		background: var(--mhn-bg-selected);
		box-shadow: 0 0 0 1px var(--mhn-border);
		color: var(--mhn-text-primary);
	}
	.mhn-seg label:has(:focus-visible) {
		outline: 2px solid var(--mhn-focus);
		outline-offset: 1px;
	}
	.mhn-slider-head {
		display: flex;
		justify-content: space-between;
		gap: 16px;
	}
	.mhn-slider-head .mhn-label { margin: 0; }
	.mhn-slider-head output {
		color: var(--mhn-text-primary);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.mhn-pop input[type="range"] {
		display: block;
		width: 100%;
		height: 24px;
		margin: 0;
		cursor: pointer;
	}
	.mhn-status {
		min-height: 20px;
		margin: 6px 0 0;
		font-size: 13px;
	}
	.mhn-status:empty { display: none; }
	.mhn-btn {
		justify-self: start;
		height: 36px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
		box-shadow: 0 0 0 1px var(--mhn-border-subtle);
		color: var(--mhn-text-primary);
		font: 500 14px/20px var(--mhn-font);
		cursor: pointer;
		transition: var(--mhn-tint), var(--mhn-press);
	}
	.mhn-btn:active { transform: scale(0.97); }

	.mhn-cal-head {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) 80px 36px;
		gap: 6px;
		align-items: center;
	}
	.mhn-cal table {
		width: calc(100% + 4px);
		margin: -2px;
		border-collapse: separate;
		border-spacing: 2px;
		table-layout: fixed;
	}
	.mhn-cal th {
		height: 28px;
		color: var(--mhn-text-tertiary);
		font-size: 12px;
		font-weight: 500;
		text-align: center;
	}
	.mhn-cal td { text-align: center; }
	.mhn-cal-day {
		display: grid;
		place-items: center;
		height: 36px;
		border-radius: var(--mhn-radius);
		color: var(--mhn-text-primary);
		font-variant-numeric: tabular-nums;
		transition: var(--mhn-tint);
	}
	/* A day that the reader opened before is dimmer, like any visited link. */
	a.mhn-cal-day:visited { color: var(--mhn-text-tertiary); }
	span.mhn-cal-day { color: var(--mhn-text-disabled); }
	.mhn-cal-day[data-today] { box-shadow: inset 0 0 0 1px var(--mhn-border-strong); }
	.mhn-cal-day[aria-current="date"], a.mhn-cal-day[aria-current="date"]:visited {
		background: var(--mhn-accent-solid);
		box-shadow: none;
		color: var(--mhn-on-accent);
		font-weight: 600;
	}
	.mhn-cal-day:focus-visible { border-radius: var(--mhn-radius); }
	.mhn-cal-quick {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-block-start: 16px;
		border-block-start: 1px solid var(--mhn-border-subtle);
	}
	.mhn-cal-quick a {
		padding: 4px 10px;
		border-radius: var(--mhn-radius);
		background: var(--mhn-bg-raised);
		color: var(--mhn-text-secondary);
		font-size: 13px;
		line-height: 20px;
		transition: var(--mhn-tint);
	}

	/* ---------- Jump buttons ---------- */

	/* The buttons sit next to the reading column, not in the corner of the
	   window, so the pointer has a short way to them. */
	.mhn-jump {
		--mhn-jump-width: 44px;
		position: fixed;
		inset-inline-end: max(
			calc(16px + env(safe-area-inset-right, 0px)),
			calc(50vw - var(--mhn-col) / 2 - 40px - var(--mhn-jump-width)));
		/* The script sets --mhn-jump-lift near the end of the page, so the
		   buttons stop at the end of the content and stay out of the footer. */
		inset-block-end: max(calc(24px + env(safe-area-inset-bottom, 0px)), var(--mhn-jump-lift, 0px));
		z-index: 10;
		display: grid;
		gap: 12px;
	}
	/* Two control heights on the page: 36px for buttons and fields, 44px here. */
	.mhn-jump .mhn-icon-btn {
		width: 44px;
		height: 44px;
	}
	/* Diamond layout: page top and bottom on the vertical axis, threads on the horizontal axis. */
	.mhn-jump--threads {
		--mhn-jump-width: 132px;
		display: block;
		width: 132px;
		height: 124px;
	}
	.mhn-jump--threads .mhn-icon-btn { position: absolute; }
	.mhn-jump--threads [data-mhn-jump="top"] { inset-inline-start: 44px; inset-block-start: 0; }
	.mhn-jump--threads [data-mhn-jump="prev"] { inset-inline-start: 0; inset-block-start: 40px; }
	.mhn-jump--threads [data-mhn-jump="next"] { inset-inline-end: 0; inset-block-start: 40px; }
	.mhn-jump--threads [data-mhn-jump="bottom"] { inset-inline-start: 44px; inset-block-end: 0; }
	/* A phone has no room for the diamond; one column covers less text. */
	@media (max-width: 48rem) {
		.mhn-jump--threads {
			--mhn-jump-width: 44px;
			display: grid;
			width: auto;
			height: auto;
		}
		.mhn-jump--threads .mhn-icon-btn { position: relative; inset: auto; }
	}
	/* Compact state: the script sets it when the buttons do not fit beside the
	   text column. Only a dot shows; the buttons appear when the pointer is on
	   the dot, when focus is in the group, or after a tap on the dot. A hidden
	   button takes no clicks, so the text below it stays usable. */
	.mhn-jump-dot {
		display: none;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}
	.mhn-jump-dot::before {
		content: "";
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--mhn-text-tertiary);
		box-shadow: 0 0 0 3px var(--mhn-bg-page);
		transition: var(--mhn-tint);
	}
	.mhn-jump-dot:focus-visible { border-radius: 50%; }
	.mhn-jump--threads .mhn-jump-dot {
		position: absolute;
		inset-inline-start: 44px;
		inset-block-start: 40px;
	}
	.mhn-jump[data-compact] {
		pointer-events: none;
		.mhn-jump-dot {
			display: grid;
			pointer-events: auto;
		}
		.mhn-icon-btn {
			opacity: 0;
			transition: opacity 120ms ease-out, var(--mhn-tint), var(--mhn-press);
		}
		&:is(:hover, :focus-within, [data-open]) {
			pointer-events: auto;
			.mhn-icon-btn { opacity: 1; }
		}
	}
	@media (max-width: 48rem) {
		.mhn-jump--threads .mhn-jump-dot { position: static; }
	}

	/* ---------- Hover states, only where a pointer can hover ---------- */

	@media (hover: hover) and (pointer: fine) {
		.mhn-tabs a:hover,
		.mhn-account a:hover,
		.mhn-meta a:hover,
		.mhn-navs a:hover,
		.reply a:hover,
		.yclinks a:hover,
		.mhn-seg label:hover,
		.mhn-cal-quick a:hover,
		a.togg:hover {
			color: var(--mhn-text-primary);
		}
		.mhn-account a:hover, a.togg:hover { background: var(--mhn-bg-raised); }
		.mhn-meta a:hover, .titleline > a:hover, .reply a:hover, .yclinks a:hover { text-decoration: underline; text-underline-offset: 0.15em; }
		a.morelink:hover,
		.mhn-btn:hover,
		.mhn-cal-quick a:hover,
		.mhn-day > :not([aria-disabled="true"]):hover,
		a.mhn-cal-day:not([aria-current]):hover,
		.mhn-icon-btn:not([aria-disabled="true"]):hover {
			background: var(--mhn-bg-hover);
			color: var(--mhn-text-primary);
		}
		input[type="submit"]:not(:disabled):hover { background: var(--mhn-accent-solid-hover); }
	}

	@media (prefers-reduced-motion: reduce) {
		*, *::before, *::after {
			transition-duration: 0.01ms !important;
			scroll-behavior: auto !important;
		}
	}
}
`;

	let depthRules = '';
	for (let depth = 1; depth <= MAX_DEPTH; depth++) {
		// The text cell needs the depth too: a code block sizes itself from it.
		// Each selector ends in a class, so the browser tests these 120 rules
		// only on the two cells of a comment. A selector that ends in :is()
		// is tested on every element of the page.
		depthRules += `:root:root td.ind[indent="${depth}"],:root:root td.ind[indent="${depth}"]~td.default{--mhn-depth:${depth}}`;
	}

	/* ---------- Fonts ---------- */

	const FONTSOURCE = 'https://cdn.jsdelivr.net/fontsource/fonts';
	const FONT_KEY = 'mhn-font:';
	const OLD_FONT_KEY = 'mhn-font';
	// Sent on the document when a setting or the state of a font changes.
	const SETTINGS_EVENT = 'mhn-settings';
	const SUBSETS = {
		latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
		'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
	};
	const fontsourceFiles = (id, italic) => (italic ? ['normal', 'italic'] : ['normal']).flatMap((style) => (
		Object.keys(SUBSETS).map((subset) => ({ style, subset, url: `${FONTSOURCE}/${id}:vf@latest/${subset}-wght-${style}.woff2` }))
	));

	// [id on the Fontsource CDN, name, kind, has an italic file].
	// Every entry is a variable font with a weight axis, so one file covers all weights.
	const FONTSOURCE_FONTS = [
		['atkinson-hyperlegible-next', 'Atkinson Hyperlegible Next', 'sans', 1],
		['bricolage-grotesque', 'Bricolage Grotesque', 'sans', 0],
		['dm-sans', 'DM Sans', 'sans', 1],
		['figtree', 'Figtree', 'sans', 1],
		['geist', 'Geist', 'sans', 1],
		['hanken-grotesk', 'Hanken Grotesk', 'sans', 1],
		['host-grotesk', 'Host Grotesk', 'sans', 1],
		['ibm-plex-sans', 'IBM Plex Sans', 'sans', 1],
		['instrument-sans', 'Instrument Sans', 'sans', 1],
		['inter', 'Inter', 'sans', 1],
		['inter-tight', 'Inter Tight', 'sans', 1],
		['lexend', 'Lexend', 'sans', 0],
		['manrope', 'Manrope', 'sans', 0],
		['mona-sans', 'Mona Sans', 'sans', 1],
		['nunito-sans', 'Nunito Sans', 'sans', 1],
		['onest', 'Onest', 'sans', 0],
		['outfit', 'Outfit', 'sans', 0],
		['plus-jakarta-sans', 'Plus Jakarta Sans', 'sans', 1],
		['public-sans', 'Public Sans', 'sans', 1],
		['rubik', 'Rubik', 'sans', 1],
		['schibsted-grotesk', 'Schibsted Grotesk', 'sans', 1],
		['source-sans-3', 'Source Sans 3', 'sans', 1],
		['work-sans', 'Work Sans', 'sans', 1],
		['bitter', 'Bitter', 'serif', 1],
		['crimson-pro', 'Crimson Pro', 'serif', 1],
		['eb-garamond', 'EB Garamond', 'serif', 1],
		['fraunces', 'Fraunces', 'serif', 1],
		['libre-baskerville', 'Libre Baskerville', 'serif', 1],
		['literata', 'Literata', 'serif', 1],
		['lora', 'Lora', 'serif', 1],
		['merriweather', 'Merriweather', 'serif', 1],
		['newsreader', 'Newsreader', 'serif', 1],
		['roboto-serif', 'Roboto Serif', 'serif', 1],
		['source-serif-4', 'Source Serif 4', 'serif', 1],
		['fira-code', 'Fira Code', 'mono', 0],
		['geist-mono', 'Geist Mono', 'mono', 1],
		['jetbrains-mono', 'JetBrains Mono', 'mono', 1],
		['martian-mono', 'Martian Mono', 'mono', 0],
		['roboto-mono', 'Roboto Mono', 'mono', 1],
		['source-code-pro', 'Source Code Pro', 'mono', 1],
	].map(([id, name, kind, italic]) => ({ id, name, kind, files: fontsourceFiles(id, italic) }));
	// Fontsource does not have these fonts; the files come from their makers.
	// Each version is fixed because the path of a file is not a promise of the maker.
	const MAKER_FONTS = [
		{
			// One file has the weight, roundness and optical size axes. The drawn
			// obliques are separate files with a fixed roundness, so the browser
			// slants this file for italic text and the roundness stays the same.
			id: 'allo',
			name: 'Allo',
			kind: 'sans',
			round: true,
			files: [{ style: 'normal', url: 'https://cdn.jsdelivr.net/gh/joshpuckett/allo@1.0.3/fonts/webfonts/AlloVariable.woff2' }],
		},
		{
			// One weight and no italic.
			id: 'geist-serif',
			name: 'Geist Serif',
			kind: 'serif',
			files: [{ style: 'normal', url: 'https://cdn.jsdelivr.net/npm/geist@1.9.2/dist/fonts/geist-serif/GeistSerif-Regular.woff2' }],
		},
	];
	const WEB_FONTS = [...FONTSOURCE_FONTS, ...MAKER_FONTS].sort((a, b) => a.name.localeCompare(b.name));
	const WEB_FONT = new Map(WEB_FONTS.map((font) => [font.id, font]));
	// Fonts of the device. The first three are in the "System" group of the list.
	const LOCAL_FONTS = [['default', 'Sans', 'sans'], ['system-serif', 'Serif', 'serif'], ['system-mono', 'Mono', 'mono'], ['custom', 'Custom…', 'sans']];
	const LOCAL_KIND = new Map(LOCAL_FONTS.map(([id, , kind]) => [id, kind]));
	// Settings saved by version 1.1 used these names.
	const OLD_FONT_IDS = { sans: 'default', serif: 'system-serif', mono: 'system-mono' };
	// The text and the headings each have a font. A heading font of "same" follows the text.
	const SAME_FONT = 'same';
	// [key]: the setting with the font id. [nameKey]: the setting with the name
	// of a font on the device. [follows]: the label of the choice that follows the text font.
	const FONT_ROLES = [
		{ key: 'font', nameKey: 'custom', attribute: 'data-mhn-font', variable: '--mhn-font-pick', label: 'Text font', nameLabel: 'Name of a font on this device' },
		{ key: 'heading', nameKey: 'headingCustom', attribute: 'data-mhn-heading', variable: '--mhn-heading-pick', label: 'Heading font', nameLabel: 'Name of a heading font on this device', follows: 'Same as the text' },
	];

	// The functions of the userscript manager. The site's security policy
	// blocks a request from the page to another site, and the storage of the
	// page is too small for font files.
	const gm = {
		request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
		get: typeof GM_getValue === 'function' ? GM_getValue : () => undefined,
		set: typeof GM_setValue === 'function' ? GM_setValue : () => {},
		remove: typeof GM_deleteValue === 'function' ? GM_deleteValue : () => {},
		keys: typeof GM_listValues === 'function' ? GM_listValues : () => [],
	};

	function toBase64(buffer) {
		const bytes = new Uint8Array(buffer);
		let text = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(text);
	}

	function fromBase64(text) {
		const binary = atob(text);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	function gmGet(url, responseType, timeout) {
		return new Promise((resolve, reject) => {
			if (!gm.request) {
				reject(new Error('no request permission'));
				return;
			}
			gm.request({
				method: 'GET',
				url,
				responseType,
				timeout,
				onload: (response) => (response.status === 200 ? resolve(response) : reject(new Error(`HTTP ${response.status}`))),
				onerror: () => reject(new Error('network')),
				ontimeout: () => reject(new Error('timeout')),
			});
		});
	}

	function registerFont(font, files) {
		for (const file of files) {
			document.fonts.add(new FontFace(`mhn-${font.id}`, fromBase64(file.data), {
				style: file.style,
				weight: '100 900',
				unicodeRange: SUBSETS[file.subset],
			}));
		}
	}

	// The files of a downloaded font stay in the manager's storage, each font
	// under its own key, so the next page shows the font at once and reads
	// only the fonts in use.
	function saveFont(id, files) {
		try {
			gm.set(FONT_KEY + id, files);
		} catch {
			// Without the saved copy the font still works; it downloads again on the next page.
		}
	}

	function savedFont(id) {
		const files = gm.get(FONT_KEY + id);
		if (Array.isArray(files)) return files;
		// Version 1.6 saved one font as { id, files } and version 1.7 saved
		// { [id]: files }, both under one key.
		const old = gm.get(OLD_FONT_KEY);
		const oldFiles = old && typeof old === 'object' ? (old.id === id ? old.files : old[id]) : null;
		if (!Array.isArray(oldFiles)) return null;
		saveFont(id, oldFiles);
		return oldFiles;
	}

	// Removes each saved font that is not in use, so the storage does not grow
	// with each font that the reader tries.
	function pruneFonts(idsInUse) {
		for (const key of gm.keys()) {
			if (key === OLD_FONT_KEY || (key.startsWith(FONT_KEY) && !idsInUse.includes(key.slice(FONT_KEY.length)))) gm.remove(key);
		}
	}

	async function fetchFont(font) {
		let files = savedFont(font.id);
		if (!files) {
			files = await Promise.all(font.files.map(async ({ style, subset, url }) => ({
				style,
				subset,
				data: toBase64((await gmGet(url, 'arraybuffer', 20000)).response),
			})));
			saveFont(font.id, files);
		}
		registerFont(font, files);
	}

	// The state of each font that the page asked for: "loading", "ready" or "error".
	const fontState = new Map();
	function loadFont(font) {
		if (fontState.has(font.id)) return;
		const settle = (state) => {
			fontState.set(font.id, state);
			document.dispatchEvent(new Event(SETTINGS_EVENT));
		};
		fontState.set(font.id, 'loading');
		fetchFont(font).then(() => settle('ready'), () => settle('error'));
	}

	/* ---------- Display settings ---------- */

	const PREFS_KEY = 'mhn-prefs';
	const THEMES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']];
	const WARM_HUE = 60;
	const COOL_HUE = 250;
	// [key, label, min, max, step, text for a value].
	const SLIDERS = [
		['tone', 'Tone', -100, 100, 5, (value) => (value === 0 ? 'Neutral' : value < 0 ? `Warm ${-value}` : `Cool ${value}`)],
		['lightness', 'Lightness', 0, 100, 5, String],
		['contrast', 'Contrast', 0, 100, 5, String],
		['size', 'Text size', 13, 20, 1, (value) => `${value} px`],
		['weight', 'Text weight', 300, 500, 25, String],
		['round', 'Roundness', 0, 100, 5, String],
		['width', 'Page width', 80, 160, 5, (value) => `${value}%`],
	];
	const DEFAULTS = { theme: 'dark', tone: -25, lightness: 50, contrast: 50, font: 'default', custom: '', heading: 'same', headingCustom: '', size: 16, weight: 400, round: 50, width: 100, votes: false, pin: true, fold: -1 };
	// [depth of the comments that start folded, label]. 0 is a top comment, 1 is a reply to it.
	const FOLD_DEPTHS = [[-1, 'Off'], [0, '0: top comments'], [1, '1: replies'], [2, '2'], [3, '3'], [4, '4'], [5, '5']];

	// The roundness setting applies only when a font in use has that axis.
	const hasRoundFont = () => FONT_ROLES.some(({ key }) => WEB_FONT.get(prefs[key])?.round);
	const fontsInUse = () => FONT_ROLES.map(({ key }) => prefs[key]);
	const isFontId = (id) => WEB_FONT.has(id) || LOCAL_KIND.has(id);
	const cleanFontName = (name) => String(name).replace(/["\\;{}<>\r\n]/g, '').trim().slice(0, 80);

	// Saved values come from storage that other code can write, so each one is
	// checked before it reaches an attribute or a style.
	function cleanPrefs(raw) {
		const value = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
		// Version 1.2 saved the same control as "darkness", with the scale reversed.
		if (raw && raw.lightness == null && raw.darkness != null) value.lightness = 100 - Number(raw.darkness);
		const fold = Number(value.fold);
		const clean = {
			theme: THEMES.some(([id]) => id === value.theme) ? value.theme : DEFAULTS.theme,
			votes: value.votes === true,
			pin: value.pin !== false,
			fold: FOLD_DEPTHS.some(([depth]) => depth === fold) ? fold : DEFAULTS.fold,
		};
		for (const { key, nameKey, follows } of FONT_ROLES) {
			const id = OLD_FONT_IDS[value[key]] || value[key];
			clean[key] = isFontId(id) || (follows && id === SAME_FONT) ? id : DEFAULTS[key];
			clean[nameKey] = cleanFontName(value[nameKey]);
		}
		for (const [key, , min, max] of SLIDERS) {
			const number = Math.round(Number(value[key]));
			clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : DEFAULTS[key];
		}
		return clean;
	}

	function readPrefs() {
		try {
			return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY)));
		} catch {
			return { ...DEFAULTS };
		}
	}

	let prefs = readPrefs();

	// A write to a variable or an attribute of the root element makes the
	// browser style the page again, so only a new value is written.
	const appliedToRoot = new Map();
	const isNewForRoot = (name, value) => {
		if (appliedToRoot.get(name) === value) return false;
		appliedToRoot.set(name, value);
		return true;
	};
	function setRootVar(name, value) {
		const text = String(value);
		if (!isNewForRoot(name, text)) return;
		if (text) document.documentElement.style.setProperty(name, text);
		else document.documentElement.style.removeProperty(name);
	}
	// A string sets the attribute, true sets it with no value, and all other values remove it.
	function setRootAttr(name, value) {
		const text = value === true ? '' : typeof value === 'string' ? value : null;
		if (!isNewForRoot(name, text)) return;
		if (text === null) document.documentElement.removeAttribute(name);
		else document.documentElement.setAttribute(name, text);
	}

	function applyPrefs() {
		setRootAttr('data-mhn-theme', prefs.theme);
		setRootAttr('data-mhn-votes', prefs.votes);
		setRootAttr('data-mhn-unpinned', !prefs.pin);
		setRootVar('--mhn-d', 1 - prefs.lightness / 100);
		setRootVar('--mhn-k', prefs.contrast / 100);
		setRootVar('--mhn-h', prefs.tone < 0 ? WARM_HUE : COOL_HUE);
		setRootVar('--mhn-t', Math.abs(prefs.tone) / 100);
		setRootVar('--mhn-size', prefs.size);
		setRootVar('--mhn-weight', prefs.weight);
		setRootVar('--mhn-w', prefs.width / 100);
		setRootVar('--mhn-round', prefs.round);
		setRootAttr('data-mhn-round', hasRoundFont());
		for (const role of FONT_ROLES) applyFont(role);
	}

	function applyFont({ key, nameKey, attribute, variable }) {
		const id = prefs[key];
		const web = WEB_FONT.get(id);
		// Without the attribute, the stylesheet makes the role follow the text font.
		setRootAttr(attribute, id === SAME_FONT ? null : web ? web.kind : LOCAL_KIND.get(id));
		setRootVar(variable, web ? `"mhn-${web.id}"` : id === 'custom' && prefs[nameKey] ? `"${prefs[nameKey]}"` : '');
		if (web) loadFont(web);
	}

	let saveTimer = 0;
	function savePrefs() {
		if (!saveTimer) return;
		clearTimeout(saveTimer);
		saveTimer = 0;
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
		} catch {
			// Storage can be blocked; the settings then last until the page closes.
		}
		pruneFonts(fontsInUse());
	}

	// The page changes at once. The save waits until the reader stops: each
	// save makes every other open tab of the site apply the settings again.
	function setPrefs(change) {
		prefs = cleanPrefs({ ...prefs, ...change });
		applyPrefs();
		clearTimeout(saveTimer);
		saveTimer = setTimeout(savePrefs, 300);
	}
	window.addEventListener('pagehide', savePrefs);

	// A change in another tab reaches this tab through the storage event.
	window.addEventListener('storage', (event) => {
		if (event.key !== PREFS_KEY) return;
		clearTimeout(saveTimer);
		saveTimer = 0;
		prefs = readPrefs();
		applyPrefs();
		document.dispatchEvent(new Event(SETTINGS_EVENT));
	});

	const style = document.createElement('style');
	style.id = 'mhn-style';
	style.textContent = css + depthRules;
	const start = () => {
		document.documentElement.append(style);
		applyPrefs();
	};
	// At document-start the root element may not exist yet.
	if (document.documentElement) {
		start();
	} else {
		new MutationObserver((_, observer) => {
			if (!document.documentElement) return;
			observer.disconnect();
			start();
		}).observe(document, { childList: true });
	}

	// A browser without highlight inheritance does not pass the highlight
	// colours of the root element down the tree. It gets the rules for all
	// elements. The check reads a computed style, so it runs when the page is idle.
	function checkHighlightColours() {
		const selection = (node) => getComputedStyle(node, '::selection').backgroundColor;
		const inBody = selection(document.body);
		const inherited = inBody === selection(document.documentElement) && inBody !== getComputedStyle(document.body).backgroundColor;
		if (!inherited) style.append(`:root:root ::selection { ${HIGHLIGHT_COLOURS} } :root:root ::highlight(mhn-find) { ${HIGHLIGHT_COLOURS} }`);
	}

	// Path data from the Lucide icon set (24px grid, 2px stroke). Arrows mean
	// "move"; the chevron is kept for the fold control alone.
	const ICONS = {
		top: '<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>',
		bottom: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
		up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
		down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
		left: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
		right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
		calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
		sliders: '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
		search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
		close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	};
	const icon = (name) => `<svg class="mhn-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

	function el(tag, attrs = {}, ...children) {
		const node = document.createElement(tag);
		for (const [key, value] of Object.entries(attrs)) {
			if (value != null) node.setAttribute(key, value);
		}
		node.append(...children);
		return node;
	}

	const selectBox = (select) => el('span', { class: 'mhn-select' }, select);

	const iconButton = (label, iconName, attrs = {}) => {
		const node = el('button', { type: 'button', class: 'mhn-icon-btn', 'aria-label': label, title: label, ...attrs });
		node.innerHTML = icon(iconName);
		return node;
	};

	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const canHover = matchMedia('(hover: hover) and (pointer: fine)');

	// Puts a popover under its button. The width is passed in because the
	// panel has no size before it opens.
	function anchorPopover(button, panel, width, align) {
		panel.style.setProperty('--mhn-pop-width', `${width}px`);
		const place = () => {
			const rect = button.getBoundingClientRect();
			const room = document.documentElement.clientWidth;
			const shown = Math.min(width, room - 16);
			const wanted = align === 'center' ? rect.left + rect.width / 2 - shown / 2 : rect.right - shown;
			panel.style.setProperty('--mhn-pop-left', `${Math.max(8, Math.min(wanted, room - shown - 8))}px`);
			panel.style.setProperty('--mhn-pop-top', `${Math.max(8, rect.bottom + 8)}px`);
		};
		panel.addEventListener('beforetoggle', (event) => {
			const open = event.newState === 'open';
			button.setAttribute('aria-expanded', String(open));
			if (open) {
				place();
				window.addEventListener('scroll', place, { passive: true });
				window.addEventListener('resize', place);
			} else {
				window.removeEventListener('scroll', place);
				window.removeEventListener('resize', place);
			}
		});
	}

	/* ---------- Header ---------- */

	function isCurrentPage(link) {
		if (link.closest('.topsel')) return true;
		const path = new URL(link.href, location.href).pathname;
		if (path === '/news') return location.pathname === '/' || location.pathname === '/news';
		return path === location.pathname;
	}

	function buildHeader() {
		const main = document.getElementById('hnmain');
		const [left, right] = main ? main.querySelectorAll('span.pagetop') : [];
		if (!left) return;

		const nativeRow = left.closest('#hnmain > tbody > tr');
		const home = left.querySelector('.hnname a');
		const logo = nativeRow.querySelector('img[src$="y18.svg"]');

		const brand = el('a', { class: 'mhn-brand', href: home ? home.getAttribute('href') : 'news' });
		if (logo) {
			logo.alt = '';
			brand.append(logo);
		}
		brand.append(el('span', { translate: 'no' }, 'Hacker News'));

		const tabList = el('ul');
		const account = el('div', { class: 'mhn-account' });
		const addTab = (link) => {
			if (isCurrentPage(link)) link.setAttribute('aria-current', 'page');
			tabList.append(el('li', {}, link));
		};
		addTab(el('a', { href: 'news' }, 'top'));
		// Some native pages (submit, for one) have a header with a title and no
		// links. They get the standard links, so the header is the same on each page.
		const nativeLinks = [...left.querySelectorAll('a')].filter((link) => link !== home);
		if (!nativeLinks.length) {
			for (const [href, label] of [['newest', 'new'], ['newcomments', 'comments'], ['ask', 'ask'], ['show', 'show'], ['jobs', 'jobs'], ['submit', 'submit']]) {
				nativeLinks.push(el('a', { href }, label));
			}
		}
		for (const link of nativeLinks) {
			const href = link.getAttribute('href') || '';
			// The day control in the header replaces the "past" tab.
			if (href === 'front') continue;
			if (href === 'submit' || href.startsWith('threads')) account.append(link);
			else addTab(link);
		}
		for (const node of right ? [...right.childNodes] : []) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				account.append(node);
			} else {
				const karma = /\((\d+)\)/.exec(node.data);
				if (karma) account.append(el('span', { class: 'mhn-karma', title: 'Karma' }, karma[1]));
			}
		}
		// The icon buttons are one unit, so they never wrap apart.
		account.append(el('div', { class: 'mhn-tools' }));

		const header = el('header', { class: 'mhn-header' },
			el('a', { class: 'mhn-skip', href: '#hnmain' }, 'Skip to content'),
			el('div', { class: 'mhn-header-inner' },
				brand,
				el('div', { class: 'mhn-mid' }, el('nav', { class: 'mhn-tabs', 'aria-label': 'Primary' }, tabList)),
				account,
			),
		);
		nativeRow.classList.add('mhn-native-header');
		document.body.prepend(header);

		// The header grows when its rows wrap, so the scroll offset under it
		// comes from its real height.
		let space = '';
		new ResizeObserver(() => {
			const pinned = getComputedStyle(header).position === 'sticky';
			const next = `calc(${pinned ? header.offsetHeight : 0}px + 1rem)`;
			if (next === space) return;
			space = next;
			document.documentElement.style.scrollPaddingBlockStart = next;
		}).observe(header);
	}

	/* ---------- Meta rows ---------- */

	// Collects the meaningful parts of a native meta row. The native separators
	// (" | ", " by ") are dropped; any other loose text, such as "[dead]" or
	// "on:", is kept as a note.
	function collectMeta(node, out) {
		for (const child of [...node.childNodes]) {
			if (child.nodeType === Node.TEXT_NODE) {
				const text = child.data.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
				if (text && text !== 'by') out.push(el('span', { class: 'mhn-note' }, text));
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				if (child.matches('span.navs, span.onstory')) collectMeta(child, out);
				else out.push(child);
			}
		}
		return out;
	}

	// One item of a meta row: a separator and a part. A long thread needs some
	// 5,000 items, and a copy of a prepared node costs less than its pieces
	// made one by one.
	const itemTemplate = el('span', { class: 'mhn-item' }, el('span', { class: 'mhn-sep', 'aria-hidden': 'true' }, '·'));
	const metaItem = (part) => {
		const item = itemTemplate.cloneNode(true);
		item.append(part);
		return item;
	};
	const isNavLink = (node) => node.matches('a:not(.togg)') && NAV_WORDS.has(node.textContent.trim());

	function rebuildMeta(container, lead) {
		const parts = collectMeta(container, []);
		const toggle = parts.find((part) => part.matches('a.togg'));
		const navLinks = parts.filter(isNavLink);
		const rest = parts.filter((part) => part !== toggle && !navLinks.includes(part));
		if (lead) rest.unshift(lead);

		const items = [];
		for (let i = 0; i < rest.length; i++) {
			let part = rest[i];
			// A note such as "on:" labels the item that follows it.
			if (part.matches('.mhn-note') && part.textContent.endsWith(':') && rest[i + 1]) {
				part = el('span', { class: 'mhn-pair' }, part, rest[++i]);
			}
			items.push(metaItem(part));
		}
		if (navLinks.length) items.push(el('span', { class: 'mhn-navs' }, ...navLinks));

		container.classList.add('mhn-meta');
		if (toggle) {
			container.replaceChildren(toggle, el('span', { class: 'mhn-items' }, ...items));
		} else {
			container.classList.add('mhn-items');
			container.replaceChildren(...items);
		}
		return toggle;
	}

	function replyLabel(toggle) {
		const replies = Number(toggle.getAttribute('n')) - 1;
		if (!(replies > 0)) return null;
		return replies === 1 ? '1 reply hidden' : `${replies} replies hidden`;
	}

	function syncToggle(toggle) {
		const row = toggle.closest('tr.comtr');
		if (row) toggle.setAttribute('aria-expanded', String(!row.classList.contains('coll')));
	}

	function tidyMeta(root = document) {
		for (const subtext of root.querySelectorAll('td.subtext:not(.mhn-done)')) {
			subtext.classList.add('mhn-done');
			const container = subtext.querySelector('.subline') || subtext;
			const titleRow = subtext.closest('tr').previousElementSibling;
			const sitebit = titleRow && titleRow.querySelector('.titleline > .sitebit');
			const site = sitebit && sitebit.querySelector('a');
			if (site) {
				site.classList.add('mhn-site');
				sitebit.remove();
			}
			rebuildMeta(container, site);
		}
		for (const comhead of root.querySelectorAll('span.comhead:not(.sitebit):not(.mhn-meta)')) {
			const toggle = rebuildMeta(comhead);
			if (!toggle) continue;
			toggle.setAttribute('role', 'button');
			toggle.setAttribute('aria-label', 'Thread');
			const label = replyLabel(toggle);
			if (label) comhead.dataset.mhnReplies = label;
			syncToggle(toggle);
		}
		for (const links of root.querySelectorAll('.yclinks:not(.mhn-meta)')) rebuildMeta(links);

		// The native vote links hold an empty div and have no name. The native
		// jump links are focusable but hidden from assistive technology.
		for (const vote of root.querySelectorAll('.votelinks a:not([aria-label])')) {
			vote.setAttribute('aria-label', vote.id.startsWith('down_') ? 'Downvote' : 'Upvote');
		}
		for (const link of root.querySelectorAll('a[aria-hidden="true"]')) link.removeAttribute('aria-hidden');
	}

	function labelForms() {
		const comment = document.querySelector('form[action="comment"] textarea');
		if (comment) {
			comment.id ||= 'mhn-comment';
			comment.rows = 4;
			comment.before(el('label', { class: 'mhn-label', for: comment.id }, 'Add a comment'));
		}

		// Native forms put the label text in the table cell before the field.
		for (const field of document.querySelectorAll('td > input:not([type="hidden"]):not([type="submit"]), td > textarea, td > select')) {
			const cell = field.parentElement.previousElementSibling;
			const text = cell && cell.textContent.replace(/:\s*$/, '').trim();
			if (text && !field.labels.length && !field.hasAttribute('aria-label')) field.setAttribute('aria-label', text);
		}
	}

	// Hacker News lays the page out with tables and has no headings or landmarks.
	function addSemantics() {
		for (const table of document.querySelectorAll('#hnmain, #hnmain table, body > form table')) {
			table.setAttribute('role', 'presentation');
		}
		const content = document.querySelector('#bigbox > td');
		if (content && content.childElementCount) content.setAttribute('role', 'main');
		const title = document.querySelector('.fatitem .titleline');
		if (title) {
			title.setAttribute('role', 'heading');
			title.setAttribute('aria-level', '1');
		}
	}

	/* ---------- Thread folding ---------- */

	// Hues of the hovered thread line, one for each depth, then they repeat.
	const THREAD_HUES = [50, 150, 255, 320, 95, 200];

	const depthOf = (row) => {
		const ind = row.querySelector('td.ind');
		return ind ? Number(ind.getAttribute('indent')) || 0 : 0;
	};

	function ancestorAt(row, depth) {
		for (let node = row; node; node = node.previousElementSibling) {
			if (node.classList.contains('comtr') && depthOf(node) === depth) return node;
		}
		return null;
	}

	function headerBottom() {
		const header = document.querySelector('.mhn-header');
		return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
	}

	// The thread a pointer position in the gutter belongs to: a thread line in
	// the indent cell names an ancestor; the line under the fold control names the row.
	function gutterThread(event) {
		if (!(event.target instanceof Element)) return null;
		const cell = event.target.closest('td.ind, td.votelinks');
		const row = cell && cell.closest('tr.comtr');
		if (!row || event.target.closest('a')) return null;
		if (cell.matches('td.votelinks')) {
			const toggle = row.querySelector('a.togg');
			return toggle && toggle.getAttribute('n') !== '1' ? row : null;
		}
		const depth = depthOf(row);
		const rect = cell.getBoundingClientRect();
		if (!depth || !rect.width) return null;
		const column = Math.min(depth - 1, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / depth))));
		return ancestorAt(row, column);
	}

	// A pointer that stays in one line column of one row stays on one thread,
	// so the walk up the rows runs only when the column changes.
	let gutterCell = null;
	let gutterColumn = -1;
	let gutterResult = null;

	function onGutterMove(event) {
		const cell = event.target instanceof Element ? event.target.closest('td.ind') : null;
		if (cell) {
			const depth = Number(cell.getAttribute('indent')) || 1;
			const rect = cell.getBoundingClientRect();
			const column = Math.floor((event.clientX - rect.left) / (rect.width / depth));
			if (cell === gutterCell && column === gutterColumn) return showHotLine(gutterResult);
			gutterCell = cell;
			gutterColumn = column;
		} else {
			gutterCell = null;
		}
		gutterResult = gutterThread(event);
		showHotLine(gutterResult);
	}

	const hotLine = el('div', { class: 'mhn-thread-hot', hidden: '' });
	let hotRow = null;

	function showHotLine(row) {
		if (row === hotRow) return;
		hotRow = row;
		const cell = row && !row.classList.contains('coll') && row.querySelector('td.votelinks');
		if (!cell) {
			hotLine.hidden = true;
			return;
		}
		const depth = depthOf(row);
		let last = row;
		for (let node = row.nextElementSibling; node; node = node.nextElementSibling) {
			if (!node.classList.contains('comtr')) continue;
			if (depthOf(node) <= depth) break;
			if (!node.classList.contains('noshow')) last = node;
		}
		const cellRect = cell.getBoundingClientRect();
		// The line starts under the control in the gutter: the vote arrow when
		// the reader shows the arrows, the fold control when not.
		const arrow = cell.querySelector('a');
		const control = arrow && arrow.offsetHeight ? arrow : row.querySelector('a.togg');
		const top = (control ? control.getBoundingClientRect().bottom : cellRect.top + 36) + 4;
		const bottom = last.getBoundingClientRect().bottom;
		hotLine.style.setProperty('--mhn-hot', THREAD_HUES[depth % THREAD_HUES.length]);
		hotLine.style.left = `${cellRect.left + cellRect.width / 2 - 1 + scrollX}px`;
		hotLine.style.top = `${top + scrollY}px`;
		hotLine.style.height = `${Math.max(0, bottom - top)}px`;
		hotLine.hidden = false;
		if (!hotLine.isConnected) document.body.append(hotLine);
	}

	function fold(row) {
		const toggle = row.querySelector('a.togg');
		if (!toggle) return;
		toggle.click();
		showHotLine(null);
		// A fold from far down a thread removes the content under the pointer,
		// so bring the folded comment back into view.
		const head = row.querySelector('.comhead');
		if (head && head.getBoundingClientRect().top < headerBottom()) {
			head.scrollIntoView({ block: 'start', behavior: 'instant' });
		}
	}

	// The rows that the start fold has seen. A row is folded one time only, so
	// a thread that the reader opens stays open when more rows arrive.
	const startFoldSeen = new WeakSet();

	// Gives a row the state that collstate() of hn.js gives a folded comment,
	// without a click: for a signed-in reader, hn.js sends each click to the server.
	function markFolded(row, toggle) {
		row.classList.add('coll');
		row.querySelector('td.votelinks')?.classList.add('nosee');
		row.querySelector('.comment')?.classList.add('noshow');
		toggle.textContent = `[${toggle.getAttribute('n')} more]`;
		syncToggle(toggle);
	}

	// Folds each comment at the depth that the reader set, on a page of one story.
	function foldAtStart() {
		if (prefs.fold < 0 || location.pathname !== '/item') return;
		// A link to one comment must show that comment: it and the comments above it stay open.
		const target = /^#\d+$/.test(location.hash) ? document.getElementById(location.hash.slice(1)) : null;
		const targetDepth = target && target.matches('tr.comtr') ? depthOf(target) : -1;
		const keep = targetDepth >= prefs.fold ? ancestorAt(target, prefs.fold) : null;

		// The depth of the folded comment whose replies the loop is in.
		let foldedAt = Infinity;
		for (const row of document.querySelectorAll('tr.comtr')) {
			const depth = depthOf(row);
			const isNew = !startFoldSeen.has(row);
			startFoldSeen.add(row);
			if (depth > foldedAt) {
				if (isNew) row.classList.add('noshow');
				continue;
			}
			foldedAt = Infinity;
			const toggle = row.querySelector('a.togg');
			if (isNew && depth === prefs.fold && row !== keep && toggle && !row.classList.contains('coll')) markFolded(row, toggle);
			if (row.classList.contains('coll')) foldedAt = depth;
		}
	}

	function onClick(event) {
		if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
		const toggle = event.target.closest('a.togg');
		if (toggle) {
			// hn.js changes the row state in its own click handler; read it afterwards.
			setTimeout(() => syncToggle(toggle));
			return;
		}
		if (event.target.closest('a, button, input, textarea, select, label, [popover]')) return;
		if (String(getSelection())) return;

		const thread = gutterThread(event);
		if (thread) {
			fold(thread);
			return;
		}
		const head = event.target.closest('tr.comtr td.default > div:first-child');
		if (head) fold(head.closest('tr.comtr'));
	}

	/* ---------- Comment jumping ---------- */

	function rootThreads() {
		return [...document.querySelectorAll('tr.comtr:not(.noshow, .mhn-filtered)')].filter((row) => depthOf(row) === 0);
	}

	// The index of the first item that passes the test, in a list where all
	// the items after that one pass it too.
	function firstIndex(list, test) {
		let low = 0;
		let high = list.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (test(list[middle])) high = middle;
			else low = middle + 1;
		}
		return low;
	}

	// The browser's own smooth scroll has no duration setting, and it felt slow
	// for an action that repeats. This scroll takes about half as long: the
	// browser needs about sqrt(distance) / 60 seconds, up to 0.7 seconds.
	let scrollFrame = 0;
	const stopScroll = () => cancelAnimationFrame(scrollFrame);

	// "top" is a function that gives the scroll position of the target. The
	// browser measures a comment only when it comes near the view, so on a
	// long thread the target moves while the page scrolls. Each frame reads
	// the position again, and the scroll ends when the target stays in place.
	function scrollToY(top, smooth) {
		stopScroll();
		const end = () => Math.max(0, Math.min(top(), document.documentElement.scrollHeight - innerHeight));
		// A long scroll shows only its last three screens: the browser would
		// render each comment on the way for a frame that the reader cannot read.
		const longest = smooth ? innerHeight * 3 : 0;
		const start = Math.max(end() - longest, Math.min(scrollY, end() + longest));
		const distance = Math.abs(end() - start);
		const duration = smooth && !reducedMotion.matches && distance >= 1 ? Math.min(350, (Math.sqrt(distance) / 60) * 500) : 0;
		const began = performance.now();
		let framesInPlace = 0;
		const step = (now) => {
			const progress = duration ? Math.min(1, (now - began) / duration) : 1;
			window.scrollTo({ top: start + (end() - start) * (1 - (1 - progress) ** 3), behavior: 'instant' });
			if (progress === 1) framesInPlace = Math.abs(end() - scrollY) < 1 ? framesInPlace + 1 : 0;
			if (framesInPlace < 2 && now - began < duration + 500) scrollFrame = requestAnimationFrame(step);
		};
		step(began);
	}
	// The reader's own scroll input always wins over a jump in progress.
	for (const type of ['wheel', 'touchstart']) window.addEventListener(type, stopScroll, { passive: true });

	function jumpThread(direction, smooth) {
		const line = headerBottom() + 16;
		const rows = rootThreads();
		// A read of a position inside a comment far from the view makes the
		// browser lay that comment out. The box of the row itself is known, so
		// a search on the rows finds the ones at the line, and only the heads
		// of those rows are measured.
		const headTop = (row) => row.querySelector('.comhead')?.getBoundingClientRect().top;
		let target = null;
		if (direction > 0) {
			for (let i = firstIndex(rows, (row) => row.getBoundingClientRect().bottom > line); i < rows.length && !target; i++) {
				if (headTop(rows[i]) > line + 4) target = rows[i];
			}
		} else {
			for (let i = firstIndex(rows, (row) => row.getBoundingClientRect().top >= line - 4) - 1; i >= 0 && !target; i--) {
				if (headTop(rows[i]) < line - 4) target = rows[i];
			}
		}
		const head = target && target.querySelector('.comhead');
		if (head) scrollToY(() => head.getBoundingClientRect().top + scrollY - line, smooth);
	}

	// Keyboard jumps are instant: an action that repeats many times must not
	// wait on an animation. Pointer clicks on the buttons scroll with a short one.
	const JUMPS = {
		top: (smooth) => scrollToY(() => 0, smooth),
		bottom: (smooth) => scrollToY(() => document.documentElement.scrollHeight, smooth),
		prev: (smooth) => jumpThread(-1, smooth),
		next: (smooth) => jumpThread(1, smooth),
	};

	function buildJump() {
		// Only a page with a list of stories or comments is long enough to need the buttons.
		// The rows of the user page also have the "athing" class, but no id.
		if (!document.querySelector('#hnmain tr.athing[id]')) return;
		const hasThreads = Boolean(document.querySelector('tr.comtr'));
		const group = el('div', { class: hasThreads ? 'mhn-jump mhn-jump--threads' : 'mhn-jump', role: 'group', 'aria-label': 'Jump' });
		group.append(iconButton('Top of page (Home)', 'top', { 'data-mhn-jump': 'top' }));
		if (hasThreads) {
			group.append(
				iconButton('Previous thread (K)', 'up', { 'data-mhn-jump': 'prev' }),
				iconButton('Next thread (J)', 'down', { 'data-mhn-jump': 'next' }),
			);
		}
		group.append(iconButton('Bottom of page (End)', 'bottom', { 'data-mhn-jump': 'bottom' }));
		// A touch screen has no hover, so a tap on the dot opens the group and
		// a tap outside the group closes it.
		const dot = el('button', { type: 'button', class: 'mhn-jump-dot', 'aria-label': 'Jump buttons', 'aria-expanded': 'false' });
		const setOpen = (open) => {
			group.toggleAttribute('data-open', open);
			dot.setAttribute('aria-expanded', String(open));
		};
		group.append(dot);
		group.addEventListener('click', (event) => {
			if (event.target === dot) return setOpen(!group.hasAttribute('data-open'));
			const target = event.target.closest('[data-mhn-jump]');
			if (!target) return;
			JUMPS[target.dataset.mhnJump](true);
			// After a pointer click, focus must not hold the compact group open.
			// A keyboard click has detail 0 and keeps its focus.
			if (event.detail > 0) target.blur();
		});
		document.addEventListener('pointerdown', (event) => {
			if (!group.contains(event.target)) setOpen(false);
		});
		document.body.append(group);
		// The room beside the column changes with the window, and with the
		// column itself: the text size and page width settings change its width.
		window.addEventListener('resize', fitJump);
		new ResizeObserver(fitJump).observe(document.getElementById('hnmain'));
		keepAboveFooter(group);
	}

	// Near the end of the page the jump buttons stop at the end of the content.
	function keepAboveFooter(group) {
		const content = document.getElementById('bigbox');
		if (!content) return;
		// The content ends at the last row with a height before the footer row.
		// On most pages that row is #bigbox. On the "threads" page the browser
		// moves the comment rows out of #bigbox, and they follow it.
		const footer = document.querySelector('.yclinks')?.closest('#hnmain > tbody > tr');
		const contentEnd = () => {
			let row = footer ? footer.previousElementSibling : content;
			while (row && !row.offsetHeight) row = row.previousElementSibling;
			return (row || content).getBoundingClientRect().bottom;
		};
		let frame = 0;
		let lift = -1;
		const place = () => {
			frame = 0;
			// Hacker News has no doctype; in that mode the root element's
			// clientHeight is the page height, not the window height.
			const next = Math.max(0, Math.round(innerHeight - contentEnd()));
			if (next === lift) return;
			lift = next;
			group.style.setProperty('--mhn-jump-lift', `${lift}px`);
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(place);
		};
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		// The content can change height with no scroll: a fold, more rows, a filter.
		// The observer also reports the first size, so no call is necessary
		// here; a call here would make the browser lay out the page during
		// the start of the script. The browser calls the observer after
		// layout, where a read of a position costs nothing.
		new ResizeObserver(place).observe(content.parentElement);
	}

	// The jump buttons go compact when the space beside the text column is
	// narrower than the group. The column width follows the text size, so this
	// is measured and not a media query.
	function fitJump() {
		const group = document.querySelector('.mhn-jump');
		const main = document.getElementById('hnmain');
		if (!group || !main) return;
		const width = parseFloat(getComputedStyle(group).getPropertyValue('--mhn-jump-width'));
		const room = document.documentElement.clientWidth - main.getBoundingClientRect().right;
		group.toggleAttribute('data-compact', room < width + 16);
	}

	function onKeydown(event) {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		if (!(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable], [popover]')) return;
		// "/" needs Shift on some keyboard layouts, so it is read before the Shift check.
		if (event.key === '/') {
			event.preventDefault();
			openSearch();
			return;
		}
		if (event.shiftKey) return;
		// The fold control is a link with the button role; a button also answers to Space.
		if (event.key === ' ' && event.target.matches('a.togg')) {
			event.preventDefault();
			event.target.click();
			return;
		}
		if (event.key === 'p' || event.key === 'n') {
			const step = document.querySelector(`a.mhn-day-step[data-step="${event.key === 'p' ? 'prev' : 'next'}"]`);
			if (!step) return;
			event.preventDefault();
			location.assign(step.href);
			return;
		}
		if (!document.querySelector('tr.comtr')) return;
		if (event.key === 'j') JUMPS.next(false);
		else if (event.key === 'k') JUMPS.prev(false);
		else return;
		event.preventDefault();
	}

	/* ---------- Days: the control in the header and its calendar ---------- */

	// Hacker News counts days in UTC, so every date here is a UTC date.
	const DAY = /^\d{4}-\d{2}-\d{2}$/;
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const WEEKDAYS = [['Mo', 'Monday'], ['Tu', 'Tuesday'], ['We', 'Wednesday'], ['Th', 'Thursday'], ['Fr', 'Friday'], ['Sa', 'Saturday'], ['Su', 'Sunday']];

	const today = () => new Date().toISOString().slice(0, 10);
	const dayDate = (day) => new Date(`${day}T00:00:00Z`);
	const dayOf = (year, month, date) => new Date(Date.UTC(year, month, date)).toISOString().slice(0, 10);
	const daysIn = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const clampDay = (day) => (day < FIRST_DAY ? FIRST_DAY : day > today() ? today() : day);
	const formatDay = (day, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(dayDate(day));
	const dayUrl = (day) => `/front?day=${day}`;

	function addDays(day, count) {
		const date = dayDate(day);
		return dayOf(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count);
	}

	// The same date in another month; the 31st becomes the last day of a shorter month.
	function addMonths(day, count) {
		const date = dayDate(day);
		const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
		const year = first.getUTCFullYear();
		const month = first.getUTCMonth();
		return dayOf(year, month, Math.min(date.getUTCDate(), daysIn(year, month)));
	}

	// The day that the "past" page shows, or null on every other page.
	function currentDay() {
		if (document.documentElement.getAttribute('op') !== 'front') return null;
		const shown = document.querySelector('.pagetop font');
		const candidates = [new URLSearchParams(location.search).get('day'), shown && shown.textContent.trim()];
		return candidates.find((value) => DAY.test(value || '')) || null;
	}

	function buildCalendar(current) {
		const first = dayDate(FIRST_DAY);
		const monthSelect = el('select', { 'aria-label': 'Month' }, ...MONTHS.map((name, index) => el('option', { value: index }, name)));
		const yearSelect = el('select', { 'aria-label': 'Year' });
		const previous = iconButton('Previous month', 'left');
		const next = iconButton('Next month', 'right');
		const body = el('tbody');
		const table = el('table', {},
			el('thead', {}, el('tr', {}, ...WEEKDAYS.map(([short, long]) => el('th', { scope: 'col', abbr: long }, short)))),
			body,
		);
		const quick = el('div', { class: 'mhn-cal-quick' });
		const panel = el('div', { class: 'mhn-pop mhn-cal', id: 'mhn-cal', popover: '', role: 'dialog', 'aria-label': 'Choose a day' },
			el('div', { class: 'mhn-cal-head' }, previous, selectBox(monthSelect), selectBox(yearSelect), next),
			table,
			quick,
		);

		let view = { year: 0, month: 0 };
		const monthIndex = (year, month) => year * 12 + month;

		const render = (focusDay) => {
			const last = dayDate(today());
			const min = monthIndex(first.getUTCFullYear(), first.getUTCMonth());
			const max = monthIndex(last.getUTCFullYear(), last.getUTCMonth());
			const shown = Math.min(max, Math.max(min, monthIndex(view.year, view.month)));
			view = { year: Math.floor(shown / 12), month: shown % 12 };

			yearSelect.replaceChildren();
			for (let year = last.getUTCFullYear(); year >= first.getUTCFullYear(); year--) yearSelect.append(el('option', { value: year }, String(year)));
			yearSelect.value = view.year;
			for (const option of monthSelect.options) {
				const index = monthIndex(view.year, Number(option.value));
				option.disabled = index < min || index > max;
			}
			monthSelect.value = view.month;
			previous.setAttribute('aria-disabled', String(shown <= min));
			next.setAttribute('aria-disabled', String(shown >= max));

			const count = daysIn(view.year, view.month);
			const days = Array.from({ length: count }, (_, index) => dayOf(view.year, view.month, index + 1));
			const open = days.filter((day) => day >= FIRST_DAY && day <= today());
			// One day is in the tab order; the arrow keys reach the others.
			const tabStop = [focusDay, current, today()].find((day) => open.includes(day)) || open[0];
			const lead = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() + 6) % 7;
			const cells = [...Array(lead).fill(null), ...days];
			body.replaceChildren();
			for (let i = 0; i < cells.length; i += 7) {
				const row = el('tr');
				for (const day of cells.slice(i, i + 7).concat(Array(7).fill(null)).slice(0, 7)) {
					const cell = el('td');
					if (day) {
						const number = String(Number(day.slice(8)));
						const label = `${formatDay(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${day === today() ? ', today' : ''}`;
						const node = open.includes(day)
							? el('a', { class: 'mhn-cal-day', href: dayUrl(day), 'data-day': day, tabindex: day === tabStop ? '0' : '-1', 'aria-label': label, 'aria-current': day === current ? 'date' : null }, number)
							: el('span', { class: 'mhn-cal-day', 'aria-disabled': 'true' }, number);
						if (day === today()) node.setAttribute('data-today', '');
						cell.append(node);
					}
					row.append(cell);
				}
				body.append(row);
			}
			if (focusDay) body.querySelector(`[data-day="${focusDay}"]`)?.focus();
		};

		const show = (year, month, focusDay) => {
			view = { year, month };
			render(focusDay);
		};
		const showDay = (day) => {
			const date = dayDate(day);
			show(date.getUTCFullYear(), date.getUTCMonth(), day);
		};

		previous.addEventListener('click', () => show(view.year, view.month - 1));
		next.addEventListener('click', () => show(view.year, view.month + 1));
		monthSelect.addEventListener('change', () => show(view.year, Number(monthSelect.value)));
		yearSelect.addEventListener('change', () => show(Number(yearSelect.value), view.month));

		const KEYS = {
			ArrowLeft: (day) => addDays(day, -1),
			ArrowRight: (day) => addDays(day, 1),
			ArrowUp: (day) => addDays(day, -7),
			ArrowDown: (day) => addDays(day, 7),
			PageUp: (day) => addMonths(day, -1),
			PageDown: (day) => addMonths(day, 1),
			Home: (day) => addDays(day, -((dayDate(day).getUTCDay() + 6) % 7)),
			End: (day) => addDays(day, 6 - ((dayDate(day).getUTCDay() + 6) % 7)),
		};
		table.addEventListener('keydown', (event) => {
			const from = event.target instanceof Element && event.target.getAttribute('data-day');
			const move = KEYS[event.key];
			if (!from || !move || event.ctrlKey || event.metaKey || event.altKey) return;
			event.preventDefault();
			showDay(clampDay(move(from)));
		});

		panel.addEventListener('beforetoggle', (event) => {
			if (event.newState !== 'open') return;
			const start = dayDate(current || today());
			show(start.getUTCFullYear(), start.getUTCMonth());
			const now = today();
			quick.replaceChildren(...[
				['Yesterday', addDays(now, -1)],
				['A week ago', addDays(now, -7)],
				['A month ago', addMonths(now, -1)],
				['A year ago', addMonths(now, -12)],
			].map(([label, day]) => el('a', { href: dayUrl(clampDay(day)) }, label)));
		});
		// The days are the reason to open the calendar, so focus starts on them
		// and not on the month controls.
		panel.addEventListener('toggle', (event) => {
			if (event.newState === 'open') body.querySelector('[tabindex="0"]')?.focus();
		});
		return panel;
	}

	function buildDayControl() {
		const mid = document.querySelector('.mhn-mid');
		if (!mid) return;
		const current = currentDay();

		// On a page that is not the "past" page, the control starts from today.
		const shown = current || today();
		const previousDay = shown > FIRST_DAY ? addDays(shown, -1) : null;
		// Away from the "past" page, the next arrow opens the list of today.
		const nextDay = !current ? today() : current < today() ? addDays(current, 1) : null;

		const step = (day, direction, label, iconName) => {
			const node = day
				? el('a', { class: 'mhn-day-step', 'data-step': direction, href: dayUrl(day), 'aria-label': label, title: label })
				: el('span', { class: 'mhn-day-step', 'aria-disabled': 'true', 'aria-hidden': 'true' });
			node.innerHTML = icon(iconName);
			return node;
		};
		const pill = el('button', {
			type: 'button',
			class: 'mhn-day-pill',
			popovertarget: 'mhn-cal',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
			title: 'Choose a day',
			'data-past': current ? '' : null,
		});
		pill.innerHTML = icon('calendar');
		pill.append(el('span', {}, current ? `${formatDay(current, { weekday: 'short' })} ${formatDay(current, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Today'));

		const panel = buildCalendar(current);
		anchorPopover(pill, panel, 320, 'center');
		document.body.append(panel);
		mid.append(el('div', { class: 'mhn-day', role: 'group', 'aria-label': 'Front page by day' },
			step(previousDay, 'prev', 'Previous day (P)', 'left'),
			pill,
			step(nextDay, 'next', current ? 'Next day (N)' : 'Past page of today (N)', 'right'),
		));
	}

	function buildDayHeading() {
		const current = currentDay();
		const native = document.querySelector('#bigbox > td > div');
		if (!current || !native) return;
		native.hidden = true;
		native.before(el('div', { class: 'mhn-date' }, el('h1', {},
			el('span', {}, formatDay(current, { weekday: 'long' })),
			' ',
			el('span', { class: 'mhn-date-rest' }, formatDay(current, { day: 'numeric', month: 'long', year: 'numeric' })),
		)));
	}

	/* ---------- The list of a page ---------- */

	// The list of a page: the table body that holds its stories or comments,
	// the rows of the list, the row that ends the list, and the native "More" link.
	function readList(root) {
		const first = root.querySelector('#bigbox table:not(.fatitem) > tbody > tr.athing[id]');
		const body = first && first.parentElement;
		const link = root.querySelector('#bigbox a.morelink');
		const children = body ? [...body.children] : [];
		const endAt = children.findIndex((row) => row.classList.contains('morespace') || row.contains(link));
		return {
			body,
			link,
			rows: endAt === -1 ? children : children.slice(0, endAt),
			end: children[endAt] || null,
		};
	}

	// One unit is one story or one comment: an "athing" row and the rows after
	// it that belong to it.
	function listUnits() {
		const units = [];
		for (const row of readList(document).rows) {
			if (row.classList.contains('athing')) units.push([row]);
			else if (units.length) units.at(-1).push(row);
		}
		return units;
	}

	/* ---------- "More" in place ---------- */

	// A click on "More" adds the next page to this page. When the next page
	// cannot be read, the link does what it does natively: it opens that page.
	// The observer in init() gives the new rows their meta rows, their
	// semantics and the active page filter.
	async function onMoreClick(event) {
		if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		const link = event.target instanceof Element && event.target.closest('#bigbox a.morelink');
		const here = link && readList(document);
		if (!here || !here.body) return;
		event.preventDefault();
		if (link.getAttribute('aria-busy') === 'true') return;

		const address = link.href;
		const label = link.textContent;
		link.setAttribute('aria-busy', 'true');
		link.textContent = 'Loading…';
		let next;
		try {
			const response = await fetch(address, { credentials: 'same-origin' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			next = readList(new DOMParser().parseFromString(await response.text(), 'text/html'));
			if (!next.rows.length) throw new Error('no rows');
		} catch {
			location.assign(address);
			return;
		}

		for (const row of next.rows) here.body.insertBefore(document.adoptNode(row), here.end);
		link.removeAttribute('aria-busy');
		link.textContent = label;
		if (next.link) {
			link.href = next.link.getAttribute('href');
		} else {
			const row = link.closest('tr');
			if (row.previousElementSibling?.classList.contains('morespace')) row.previousElementSibling.remove();
			row.remove();
		}
	}

	/* ---------- Page filter ---------- */

	// The filter hides the units of the list that do not contain all the
	// words, and highlights the words in the units that stay. It works on the
	// search results when they show, and on the list of the page otherwise.
	let filterQuery = '';
	// The search bar shows the count; it sets this.
	let showFilterCount = () => {};
	const unitText = new WeakMap();

	function textOf(rows) {
		let text = unitText.get(rows[0]);
		if (text === undefined) {
			text = rows.map((row) => row.textContent).join(' ').toLowerCase();
			unitText.set(rows[0], text);
		}
		return text;
	}

	function addMatchRanges(rows, terms, ranges) {
		for (const row of rows) {
			const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const lower = walker.currentNode.data.toLowerCase();
				for (const term of terms) {
					for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
						const range = new Range();
						range.setStart(walker.currentNode, at);
						range.setEnd(walker.currentNode, at + term.length);
						ranges.push(range);
					}
				}
			}
		}
	}

	function filterPage(query = filterQuery) {
		filterQuery = query;
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const results = document.querySelector('.mhn-results');
		const units = results ? [...results.querySelectorAll('.mhn-hit')].map((hit) => [hit]) : listUnits();
		const ranges = [];
		let shown = 0;
		for (const rows of units) {
			const match = terms.every((term) => textOf(rows).includes(term));
			for (const row of rows) row.classList.toggle('mhn-filtered', !match);
			if (!match) continue;
			shown++;
			if (terms.length && ranges.length <= 2000) addMatchRanges(rows, terms, ranges);
		}
		if (window.CSS && CSS.highlights && window.Highlight) {
			if (ranges.length) CSS.highlights.set('mhn-find', new Highlight(...ranges));
			else CSS.highlights.delete('mhn-find');
		}
		showFilterCount(terms.length ? `${shown} of ${units.length}` : '');
	}

	const clearFilter = () => {
		if (filterQuery) filterPage('');
	};

	/* ---------- Search and page filter ---------- */

	// Hacker News has no search of its own; its footer form opens the Algolia
	// site. This search asks the same Algolia service and shows the results
	// in this page. The userscript manager makes the request, because the
	// site's security policy blocks a request from the page.
	const SEARCH_API = 'https://hn.algolia.com/api/v1';
	const SEARCH_KEY = 'mhn-search';
	const SEARCH_HASH = '#search?';
	const SCOPES = [['hn', 'Hacker News'], ['page', 'This page']];
	const SORTS = [['date', 'Newest'], ['popularity', 'Popular']];
	const KINDS = [['story', 'Stories'], ['comment', 'Comments'], ['all', 'All']];
	const KIND_TAGS = { story: 'story', comment: 'comment', all: '(story,comment)' };
	// [id, label, length in seconds].
	const RANGES = [['all', 'Any time', 0], ['day', 'Past 24 hours', 86400], ['week', 'Past week', 604800], ['month', 'Past month', 2592000], ['year', 'Past year', 31536000]];
	const HITS_PER_PAGE = 30;
	const oneOf = (options, value, fallback) => (options.some(([id]) => id === value) ? value : fallback);
	// The options of a search: [key in the state, allowed values, default,
	// name in the page address]. The scope is not part of the address,
	// because an address always holds a search of all of Hacker News.
	const SEARCH_FIELDS = [
		['scope', SCOPES, 'hn', null],
		['sort', SORTS, 'date', 'sort'],
		['kind', KINDS, 'story', 'type'],
		['range', RANGES, 'all', 'range'],
	];

	function readSearchPrefs() {
		let saved = {};
		try {
			saved = JSON.parse(localStorage.getItem(SEARCH_KEY)) || {};
		} catch {
			// The defaults apply.
		}
		return Object.fromEntries(SEARCH_FIELDS.map(([key, options, initial]) => [key, oneOf(options, saved[key], initial)]));
	}

	function saveSearchPrefs(state) {
		try {
			localStorage.setItem(SEARCH_KEY, JSON.stringify(Object.fromEntries(SEARCH_FIELDS.map(([key]) => [key, state[key]]))));
		} catch {
			// The choice then lasts until the page closes.
		}
	}

	const searchHash = (state) => SEARCH_HASH + new URLSearchParams([
		['q', state.query],
		...SEARCH_FIELDS.filter(([, , , param]) => param).map(([key, , , param]) => [param, state[key]]),
	]);

	function readSearchHash(state) {
		const params = new URLSearchParams(location.hash.slice(SEARCH_HASH.length));
		state.scope = 'hn';
		state.query = params.get('q') || '';
		for (const [key, options, , param] of SEARCH_FIELDS) {
			if (param) state[key] = oneOf(options, params.get(param), state[key]);
		}
	}

	function searchUrl(state, query, page) {
		// "min" keeps exact matches when they exist, and allows a typo only
		// when they do not. Without it, "openai" also finds "openapi".
		const params = new URLSearchParams({ query, tags: KIND_TAGS[state.kind], hitsPerPage: HITS_PER_PAGE, page, typoTolerance: 'min' });
		// By default a comment also matches on the title of its story.
		if (state.kind === 'comment') params.set('restrictSearchableAttributes', 'comment_text');
		const length = RANGES.find(([id]) => id === state.range)[2];
		if (length) params.set('numericFilters', `created_at_i>${Math.floor(Date.now() / 1000) - length}`);
		return `${SEARCH_API}/${state.sort === 'date' ? 'search_by_date' : 'search'}?${params}`;
	}

	async function requestJson(url) {
		const response = await gmGet(url, 'json', 15000);
		// Some userscript managers do not parse a JSON response.
		return response.response && typeof response.response === 'object' ? response.response : JSON.parse(response.responseText);
	}

	// The service returns HTML: comment text, and titles with <em> around the
	// matched words. Only these tags are copied; all attributes are dropped
	// but a web link's address.
	const SAFE_TAGS = { P: 'p', I: 'i', B: 'b', PRE: 'pre', CODE: 'code', BR: 'br', A: 'a', EM: 'mark' };

	function copySafe(from, to) {
		for (const node of from.childNodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				to.append(node.data);
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				const tag = SAFE_TAGS[node.tagName];
				if (!tag) {
					copySafe(node, to);
					continue;
				}
				const copy = document.createElement(tag);
				const href = tag === 'a' ? node.getAttribute('href') || '' : '';
				if (/^https?:\/\//i.test(href)) {
					copy.href = href;
					copy.rel = 'nofollow noreferrer';
				}
				copySafe(node, copy);
				to.append(copy);
			}
		}
		return to;
	}

	const htmlParser = new DOMParser();
	const safeHtml = (html, target) => copySafe(htmlParser.parseFromString(String(html || ''), 'text/html').body, target);

	const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
	// [upper limit of the age in seconds, unit, length of the unit in seconds].
	const AGE_STEPS = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [2592000, 'day', 86400]];
	const hitDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

	function timeAgo(seconds) {
		const age = Date.now() / 1000 - seconds;
		const step = AGE_STEPS.find(([limit]) => age < limit);
		if (!step) return hitDate.format(seconds * 1000);
		return `${plural(Math.max(1, Math.floor(age / step[2])), step[1])} ago`;
	}

	function metaRow(parts) {
		return el('div', { class: 'mhn-meta mhn-items' }, ...parts.filter(Boolean).map(metaItem));
	}

	function renderHit(hit) {
		const itemUrl = `item?id=${hit.objectID}`;
		const highlight = hit._highlightResult || {};
		const author = hit.author ? el('a', { href: `user?id=${encodeURIComponent(hit.author)}` }, hit.author) : null;
		const when = el('a', { href: itemUrl, title: new Date(hit.created_at_i * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' }, timeAgo(hit.created_at_i));

		if ((hit._tags || []).includes('comment')) {
			const story = hit.story_id
				? el('span', { class: 'mhn-pair' }, el('span', { class: 'mhn-note' }, 'on:'), el('a', { href: `item?id=${hit.story_id}` }, hit.story_title || 'story'))
				: null;
			return el('li', { class: 'mhn-hit' },
				metaRow([author, when, story]),
				safeHtml((highlight.comment_text && highlight.comment_text.value) || hit.comment_text, el('div', { class: 'mhn-hit-text' })),
			);
		}

		const title = safeHtml((highlight.title && highlight.title.value) || hit.title, el('a', { class: 'mhn-hit-title', href: hit.url || itemUrl }));
		let site = null;
		try {
			const host = hit.url && new URL(hit.url).hostname.replace(/^www\./, '');
			if (host) site = el('a', { class: 'mhn-site', href: `from?site=${host}` }, host);
		} catch {
			// A story with a broken address shows no site.
		}
		return el('li', { class: 'mhn-hit' },
			title,
			metaRow([
				site,
				hit.points != null ? el('span', { class: 'score' }, plural(hit.points, 'point')) : null,
				author,
				when,
				el('a', { href: itemUrl }, plural(hit.num_comments || 0, 'comment')),
			]),
		);
	}

	// The search bar is built once, when the header exists. These are set there.
	let openSearch = () => {};

	function buildSearch() {
		const header = document.querySelector('.mhn-header');
		const account = document.querySelector('.mhn-account');
		const content = document.querySelector('#bigbox > td');
		if (!header || !account) return;

		const state = { ...readSearchPrefs(), query: '', page: 0 };

		/* The bar */

		const input = el('input', { type: 'text', role: 'searchbox', 'aria-label': 'Search', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false' });
		const field = el('span', { class: 'mhn-search-field' }, input);
		field.insertAdjacentHTML('afterbegin', icon('search'));
		// Each control names the key of the state that it sets in "data-key".
		const segment = (key, options) => {
			const track = el('div', { class: 'mhn-seg', role: 'radiogroup', 'aria-label': key });
			for (const [value, label] of options) {
				track.append(el('label', {}, el('input', { type: 'radio', name: `mhn-search-${key}`, 'data-key': key, value }), el('span', {}, label)));
			}
			return track;
		};
		const scopeTrack = segment('scope', SCOPES);
		const sortTrack = segment('sort', SORTS);
		const kindTrack = segment('kind', KINDS);
		const rangeSelect = el('select', { 'aria-label': 'Time range', 'data-key': 'range' }, ...RANGES.map(([id, label]) => el('option', { value: id }, label)));
		const status = el('p', { class: 'mhn-search-status', role: 'status' });
		const closeButton = iconButton('Close search (Esc)', 'close');
		const options = el('div', { class: 'mhn-search-options' }, sortTrack, kindTrack, selectBox(rangeSelect));
		const bar = el('div', { class: 'mhn-search', role: 'search', hidden: '' },
			el('div', { class: 'mhn-search-main' }, field, scopeTrack, closeButton),
			options,
		);
		field.append(status);
		header.append(bar);
		const button = iconButton('Search (/)', 'search', { 'aria-expanded': 'false' });
		account.querySelector('.mhn-tools').append(button);

		const radios = [...bar.querySelectorAll('input[type="radio"]')];
		const syncControls = () => {
			for (const radio of radios) radio.checked = state[radio.dataset.key] === radio.value;
			rangeSelect.value = state.range;
			const everywhere = state.scope === 'hn';
			options.hidden = !everywhere;
			input.placeholder = everywhere ? 'Search Hacker News' : 'Filter this page';
		};
		showFilterCount = (text) => {
			status.textContent = text;
		};

		/* Search of all of Hacker News */

		const heading = el('h1');
		const resultStatus = el('p', { class: 'mhn-results-status', role: 'status' });
		const list = el('ol', { class: 'mhn-hits' });
		const more = el('button', { type: 'button', class: 'mhn-btn', hidden: '' }, 'More results');
		const retry = el('button', { type: 'button', class: 'mhn-btn', hidden: '' }, 'Try again');
		const results = el('div', { class: 'mhn-results' }, el('div', { class: 'mhn-results-head' }, heading, resultStatus), list, more, retry);
		let request = 0;
		let timer = 0;

		// The root attribute lets the style sheet hide the page content; the
		// script reads the state from the results element.
		const showResults = (on) => {
			document.documentElement.toggleAttribute('data-mhn-search', on);
			if (on && !results.isConnected) content.prepend(results);
			if (!on) results.remove();
		};
		// Safe to call when no results show. Back and Forward change the
		// address themselves, so they pass false.
		const leaveResults = (resetAddress = true) => {
			request++;
			clearTimeout(timer);
			showResults(false);
			if (resetAddress && location.hash.startsWith(SEARCH_HASH)) history.pushState(null, '', location.pathname + location.search);
		};

		const runSearch = async (page = 0) => {
			clearTimeout(timer);
			const query = state.query.trim();
			if (!query || !content) {
				leaveResults();
				return;
			}
			const mine = ++request;
			// The first search adds a history entry, so Back returns to the page.
			// A changed search replaces it.
			history[location.hash.startsWith(SEARCH_HASH) ? 'replaceState' : 'pushState'](null, '', searchHash(state));
			showResults(true);
			heading.textContent = `Results for “${query}”`;
			results.setAttribute('aria-busy', 'true');
			resultStatus.textContent = 'Search in progress…';
			more.hidden = retry.hidden = true;
			if (page === 0) scrollToY(() => 0, false);

			let data;
			try {
				data = await requestJson(searchUrl(state, query, page));
			} catch {
				if (mine !== request) return;
				results.removeAttribute('aria-busy');
				resultStatus.textContent = 'The search did not work. Check the connection, then try again.';
				retry.hidden = false;
				retry.onclick = () => runSearch(page);
				return;
			}
			if (mine !== request) return;

			const hits = Array.isArray(data.hits) ? data.hits : [];
			if (page === 0) list.replaceChildren();
			const first = list.childElementCount;
			list.append(...hits.map(renderHit));
			state.page = page;
			results.removeAttribute('aria-busy');
			const total = data.nbHits || 0;
			const order = state.sort === 'date' ? 'newest first' : 'most popular first';
			resultStatus.textContent = list.childElementCount
				? `${total.toLocaleString('en-GB')} ${total === 1 ? 'result' : 'results'}, ${order}`
				: 'No results. Try other words or a longer time range.';
			more.hidden = page + 1 >= (data.nbPages || 0);
			// After "More results", keyboard focus goes to the first new result.
			if (page > 0) list.children[first]?.querySelector('a')?.focus();
		};
		more.addEventListener('click', () => runSearch(state.page + 1));

		// Search while the reader types, but not on every key.
		const update = (now) => {
			clearTimeout(timer);
			if (state.scope === 'page') {
				filterPage(state.query);
			} else {
				clearFilter();
				if (now || !state.query.trim()) runSearch();
				else timer = setTimeout(runSearch, 350);
			}
		};

		/* Events */

		const setOpen = (open) => {
			bar.hidden = !open;
			button.setAttribute('aria-expanded', String(open));
		};
		openSearch = () => {
			setOpen(true);
			syncControls();
			input.focus();
			input.select();
			if (state.scope === 'page') filterPage(state.query);
		};
		const closeSearch = () => {
			clearFilter();
			leaveResults();
			state.query = input.value = '';
			setOpen(false);
			button.focus();
		};

		button.addEventListener('click', () => (bar.hidden ? openSearch() : closeSearch()));
		closeButton.addEventListener('click', closeSearch);
		input.addEventListener('input', () => {
			state.query = input.value;
			update(false);
		});
		bar.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeSearch();
			} else if (event.key === 'Enter' && event.target === input) {
				event.preventDefault();
				update(true);
			}
		});
		bar.addEventListener('change', (event) => {
			const key = event.target.dataset.key;
			if (!key) return;
			state[key] = event.target.value;
			saveSearchPrefs(state);
			syncControls();
			update(true);
			// After a change of scope, the reader types next.
			if (key === 'scope') input.focus();
		});

		// The address holds the search, so Back, Forward and a reload keep it.
		const fromAddress = () => {
			if (!location.hash.startsWith(SEARCH_HASH)) {
				leaveResults(false);
				return;
			}
			clearFilter();
			readSearchHash(state);
			setOpen(true);
			syncControls();
			input.value = state.query;
			runSearch();
		};
		window.addEventListener('popstate', fromAddress);
		syncControls();
		fromAddress();
	}

	/* ---------- Settings panel ---------- */

	function buildSettings() {
		const account = document.querySelector('.mhn-account');
		if (!account) return;

		const themeTrack = el('div', { class: 'mhn-seg' });
		for (const [value, label] of THEMES) {
			themeTrack.append(el('label', {}, el('input', { type: 'radio', name: 'theme', value }), el('span', {}, label)));
		}

		const sliders = SLIDERS.map(([key, label, min, max, step, format]) => {
			const input = el('input', { type: 'range', id: `mhn-${key}`, name: key, min, max, step });
			const output = el('output', { for: input.id });
			const field = el('div', {},
				el('div', { class: 'mhn-slider-head' }, el('label', { class: 'mhn-label', for: input.id }, label), output),
				input,
			);
			return { key, input, output, format, field };
		});
		const slider = (key) => sliders.find((entry) => entry.key === key).field;

		const option = (id, name) => el('option', { value: id }, name);
		const group = (label, fonts) => el('optgroup', { label }, ...fonts.map((font) => option(font.id, font.name)));
		// One list of fonts and one field for the name of a font on the device.
		const FONT_STATUS = {
			loading: 'Font download in progress…',
			error: 'The font did not download. Check the connection, then load the page again.',
		};
		const fontPicker = ({ key, nameKey, label, nameLabel, follows }) => {
			const select = el('select', { id: `mhn-${key}`, name: key },
				...(follows ? [option(SAME_FONT, follows)] : []),
				group('Sans', WEB_FONTS.filter((font) => font.kind === 'sans')),
				group('Serif', WEB_FONTS.filter((font) => font.kind === 'serif')),
				group('Mono', WEB_FONTS.filter((font) => font.kind === 'mono')),
				el('optgroup', { label: 'System' }, ...LOCAL_FONTS.filter(([id]) => id !== 'custom').map(([id, name]) => option(id, name))),
				option('custom', 'Custom…'),
			);
			const name = el('input', { type: 'text', id: `mhn-${key}-name`, name: nameKey, autocomplete: 'off', spellcheck: 'false', placeholder: 'Georgia' });
			const nameField = el('div', {}, el('label', { class: 'mhn-label', for: name.id }, nameLabel), name);
			const status = el('p', { class: 'mhn-status', role: 'status' });
			return {
				field: el('div', {}, el('label', { class: 'mhn-label', for: select.id }, label), selectBox(select), status),
				nameField,
				sync: () => {
					select.value = prefs[key];
					nameField.hidden = prefs[key] !== 'custom';
					if (document.activeElement !== name) name.value = prefs[nameKey];
					// A status region speaks each write, so only a new text is written.
					const text = FONT_STATUS[fontState.get(prefs[key])] || '';
					if (status.textContent !== text) status.textContent = text;
				},
			};
		};
		const pickers = FONT_ROLES.map(fontPicker);

		const switches = [['pin', 'Pinned header'], ['votes', 'Vote arrows']].map(([key, label]) => {
			const input = el('input', { type: 'checkbox', role: 'switch', name: key });
			return { key, input, field: el('label', { class: 'mhn-switch' }, label, input) };
		});

		const foldSelect = el('select', { id: 'mhn-fold', name: 'fold' }, ...FOLD_DEPTHS.map(([depth, label]) => option(String(depth), label)));
		const foldField = el('div', {}, el('label', { class: 'mhn-label', for: 'mhn-fold' }, 'Fold comments at depth'), selectBox(foldSelect));

		const reset = el('button', { type: 'button', class: 'mhn-btn' }, 'Reset');
		const panel = el('div', { class: 'mhn-pop', id: 'mhn-settings', popover: '', role: 'dialog', 'aria-label': 'Display settings' },
			el('div', { class: 'mhn-group' },
				el('fieldset', {}, el('legend', {}, 'Theme'), themeTrack),
				slider('tone'),
				slider('lightness'),
				slider('contrast'),
			),
			el('div', { class: 'mhn-group' }, ...pickers.flatMap((picker) => [picker.field, picker.nameField]), slider('size'), slider('weight'), slider('round')),
			el('div', { class: 'mhn-group' }, slider('width'), foldField, ...switches.map((entry) => entry.field)),
			reset,
		);
		// A narrow header has no room for the logout link; it shows here then.
		const logout = document.querySelector('.mhn-account a#logout');
		if (logout) panel.append(el('a', { class: 'mhn-btn mhn-set-logout', href: logout.getAttribute('href') }, 'Log out'));

		const sync = () => {
			for (const input of themeTrack.querySelectorAll('input')) input.checked = prefs.theme === input.value;
			for (const { key, input, output, format } of sliders) {
				input.value = prefs[key];
				output.textContent = format(prefs[key]);
			}
			for (const { key, input } of switches) input.checked = prefs[key];
			foldSelect.value = String(prefs.fold);
			for (const picker of pickers) picker.sync();
			slider('round').hidden = !hasRoundFont();
		};
		// The name of each control is the key of its setting.
		panel.addEventListener('input', ({ target }) => {
			setPrefs({ [target.name]: target.type === 'checkbox' ? target.checked : target.value });
			sync();
		});
		reset.addEventListener('click', () => {
			setPrefs(DEFAULTS);
			sync();
		});
		document.addEventListener(SETTINGS_EVENT, sync);

		const button = iconButton('Display settings', 'sliders', { popovertarget: 'mhn-settings', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
		anchorPopover(button, panel, 304, 'end');
		sync();
		document.body.append(panel);
		account.querySelector('.mhn-tools').append(button);
	}

	/* ---------- Start ---------- */

	// Each part reads third-party markup that can change without notice; one
	// part that fails must not take the others down with it.
	function run(part) {
		try {
			part();
		} catch (error) {
			console.error(`[Modern HN] ${part.name} failed`, error);
		}
	}

	// The parts that also run for rows that arrive later. The start fold reads
	// the fold controls that tidyMeta prepares.
	const ROW_PARTS = [tidyMeta, foldAtStart, addSemantics];

	function init() {
		for (const part of [buildHeader, buildDayControl, buildSearch, buildSettings, ...ROW_PARTS, labelForms, buildDayHeading, buildJump]) run(part);
		(window.requestIdleCallback || setTimeout)(() => run(checkHighlightColours));

		// Capture phase: hn.js stops propagation of clicks on its own links.
		document.addEventListener('click', onClick, true);
		document.addEventListener('click', onMoreClick);
		document.addEventListener('keydown', onKeydown);
		if (canHover.matches) {
			document.addEventListener('mousemove', onGutterMove, { passive: true });
		}

		// Rows arrive after the page loads: hn.js inserts a story row after
		// "hide", and "More" adds a page of rows. Each new row gets the same
		// parts and page filter as the rows before it. A change that adds no
		// element is skipped: hn.js writes the text of a fold control on each
		// fold. No part adds an element on a second run, so the observer does
		// not call itself without end.
		const main = document.getElementById('hnmain');
		if (main) {
			new MutationObserver((records) => {
				if (!records.some((record) => [...record.addedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE))) return;
				for (const part of ROW_PARTS) run(part);
				if (filterQuery) run(filterPage);
			}).observe(main, { childList: true, subtree: true });
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
	else init();
})();
