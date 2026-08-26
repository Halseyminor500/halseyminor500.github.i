#!/usr/bin/env node
/* Inline data/banks.json into src/index.template.html -> index.html.
 * One job. The generated file has zero network dependencies. */
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname;
const tpl = readFileSync(root + 'src/index.template.html', 'utf8');
const raw = readFileSync(root + 'data/banks.json', 'utf8');

const data = JSON.parse(raw);                    // fails the build on malformed JSON

// schema guard: FY arrays index-aligned, nulls explained, no stray types
const FY = data.fyLabels;
let leaves = 0, nulls = 0, bad = [];
for (const b of data.banks) {
  const paths = new Set(b.gaps.map((g) => g.path));
  for (const [k, arr] of Object.entries(b.fy)) {
    if (k === 'labels') continue;
    if (!Array.isArray(arr) || arr.length !== FY.length)
      bad.push(`${b.ticker}.fy.${k}: length ${arr && arr.length} != ${FY.length}`);
    (arr || []).forEach((v, i) => {
      leaves++;
      if (v === null) { nulls++; if (!paths.has(`fy.${k}[${i}]`)) bad.push(`${b.ticker}.fy.${k}[${i}] null with no gaps[] entry`); }
      else if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${b.ticker}.fy.${k}[${i}] is ${typeof v}`);
    });
  }
}
if (data.banks.length !== 50) bad.push(`expected 50 banks, got ${data.banks.length}`);
if (bad.length) { console.error('BUILD FAILED:\n  ' + bad.slice(0, 20).join('\n  ')); process.exit(1); }

if (!tpl.includes('/*__DATA__*/')) { console.error('BUILD FAILED: template has no /*__DATA__*/ slot'); process.exit(1); }
const out = tpl.replace('/*__DATA__*/', () => JSON.stringify(data));
writeFileSync(root + 'index.html', out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`index.html  ${kb} KB  ·  ${data.banks.length} banks  ·  ${leaves} FY cells, ${nulls} null (${((nulls/leaves)*100).toFixed(1)}%)`);
if (kb > 900) { console.error('BUILD FAILED: over the 900 KB budget'); process.exit(1); }
