#!/usr/bin/env node
/* Patch columns of data/raw/income.tsv by ticker, from a JSON payload on argv[2].
 * Payload: { TICKER: { nic:[5], nicTTM:n, opex:[5], sal:[6], dilsh:n } }
 * Only the keys present are written; everything else is left alone. */
import { readFileSync, writeFileSync } from 'node:fs';
const P = new URL('../data/raw/income.tsv', import.meta.url).pathname;
const patch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = readFileSync(P, 'utf8').trim().split('\n').map((l) => l.split('\t'));
let touched = 0, cells = 0;
for (const r of rows) {
  const p = patch[r[0]];
  if (!p) continue;
  touched++;
  const set = (i, v) => { if (v !== undefined && v !== null) { if (String(r[i]) !== String(v)) cells++; r[i] = String(v); } };
  if (p.sal)    p.sal.forEach((v, i) => set(7 + i, v));      // FY21..25 + TTM
  if (p.opex)   p.opex.forEach((v, i) => set(13 + i, v));    // FY21..25
  if (p.nic)    p.nic.forEach((v, i) => set(18 + i, v));     // FY21..25
  if (p.nicTTM !== undefined) set(23, p.nicTTM);
  if (p.dilsh  !== undefined) set(24, p.dilsh);
  if (r.length !== 25) throw new Error(`${r[0]}: ${r.length} cols`);
}
const missing = Object.keys(patch).filter((t) => !rows.some((r) => r[0] === t));
if (missing.length) throw new Error('unknown tickers: ' + missing.join(' '));
writeFileSync(P, rows.map((r) => r.join('\t')).join('\n') + '\n');
console.log(`patched ${touched} banks, ${cells} cells changed`);
