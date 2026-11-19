# Evals

Local checks and timing tools for `modern-hn.user.js`. They run the script in Chrome on saved Hacker News pages (`fixtures/`), with the content security policy of the live site. No tool sends a request to Hacker News.

## Set up

```
npm install
```

The tools use the Chrome on this computer. For Firefox, run `npx playwright-core install firefox` one time.

## Tools

| Command | Purpose |
| --- | --- |
| `node check.mjs` | Behaviour checks: fonts, folds, jumps, the page filter, each page kind, and the layout of each page at two widths. |
| `node perf.mjs --label <name>` | Main-thread time of about 40 reader actions on a thread of 961 comments. Saves `results/<name>.json`. |
| `node perf.mjs --compare <name>` | The same, with the change from a saved result. |
| `node trace.mjs <action>` | Where the browser spends the time of one action. `--selectors` gives the cost of each CSS selector, `--why` gives the cause of each style invalidation, `--css` adds rules for a trial. |
| `node parts.mjs [path]` | Time of each start-up part of the script. |
| `node cpu.mjs [path]` | JavaScript profile of a page load. |
| `node variant.mjs <name> <find> <replace>` | Makes a trial copy of the script in `results/`. |

Environment variables:

- `MHN_SCRIPT=<file>`: use another copy of the script.
- `MHN_BROWSER=firefox`: run `check.mjs` in Firefox. The timing tools need Chrome.

## How to compare two versions

1. Save a copy of the good version, for example `git show HEAD:modern-hn.user.js > results/base.user.js`.
2. Save its numbers and its layout: set `MHN_SCRIPT` to that file, then run `node perf.mjs --label base` and `node check.mjs --save-layout`.
3. Clear `MHN_SCRIPT`. Run `node perf.mjs --compare base` and `node check.mjs`.

A change below 2 ms or 10% is inside the noise of `perf.mjs`.

## Rules that the tools taught

- A read of a position inside a comment far from the view (`getBoundingClientRect`, `offsetHeight`) makes the browser lay that comment out. Read the box of the row, or read only comments near the view. This applies to the tests too.
- A `:has()` without child combinators walks the full subtree on each style pass.
- A selector that ends in `*`, `:is()` or `:not()` is tested on every element.
- A `::selection` or `::highlight()` rule for all elements adds one computed style for each element.
- A new value of a variable or an attribute on the root element styles the page again. A property that does not inherit does not.
- `display: none` on many elements is slow when the accessibility tree of the browser is on. `content-visibility: hidden` is not.
