# Modern HN

A userscript that gives [Hacker News](https://news.ycombinator.com) a modern reading layout. It is one file with no build step. It is not affiliated with Hacker News or Y Combinator.

## Install

1. Install a userscript manager, for example [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`modern-hn.user.js`](https://raw.githubusercontent.com/FallDownTheSystem/modern-hn/main/modern-hn.user.js). The userscript manager offers to install it.
3. Reload Hacker News.

The userscript manager gets later versions from this repository.

## Features

- **Layout:** a reading column, a pinned header, a light theme and a dark theme.
- **Threads:** click the gutter of a comment to fold its thread. The thread line shows in a colour on hover. Jump buttons go to the previous thread, the next thread, the top and the bottom.
- **Past front pages:** a day control in the header with a calendar. The arrows go one day back and forward.
- **Search:** a search bar in the header. It searches all of Hacker News by date or by popularity, and shows the results in the page. It can also filter the stories or comments of the current page.
- **More:** the "More" link adds the next page of stories or comments to the current page.
- **Settings:** theme, tone, lightness, contrast, font (40 web fonts, system fonts, or a font on your computer), text size, text weight, page width, and vote arrows.

## Keys

| Key | Action |
| --- | --- |
| `J` / `K` | Next / previous thread |
| `P` / `N` | Previous / next day |
| `/` | Open the search bar |
| `Esc` | Close the search bar or a panel |

## Network access

Hacker News blocks requests from its pages to other sites, so the script asks the userscript manager for two connections:

- `hn.algolia.com`: the search. This is the same service that the search form of Hacker News uses. Your search words go to it.
- `cdn.jsdelivr.net`: the download of a web font, only when you select one. The font is then kept in the userscript storage.

The filter of the current page and all settings stay in your browser.

## Development

The script is `modern-hn.user.js`. It uses tabs and CRLF line ends. Check the syntax with `node --check modern-hn.user.js`.
