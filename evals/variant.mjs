// Makes a trial copy of the userscript, with text replaced, in results/.
//
//   node variant.mjs <name> <find> <replace> [<find> <replace> ...]
//
// "find" is a regular expression. The copy is results/<name>.user.js; run the
// other tools on it with MHN_SCRIPT set to that file.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [name, ...pairs] = process.argv.slice(2);
let text = readFileSync(fileURLToPath(new URL('../modern-hn.user.js', import.meta.url)), 'utf8');
for (let i = 0; i < pairs.length; i += 2) {
	const pattern = new RegExp(pairs[i], 'gs');
	const count = (text.match(pattern) || []).length;
	console.log(`${count} of /${pairs[i]}/`);
	text = text.replace(pattern, pairs[i + 1]);
}
mkdirSync(fileURLToPath(new URL('results/', import.meta.url)), { recursive: true });
const file = fileURLToPath(new URL(`results/${name}.user.js`, import.meta.url));
writeFileSync(file, text);
console.log(file);
