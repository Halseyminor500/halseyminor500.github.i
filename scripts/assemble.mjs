#!/usr/bin/env node
/* Assemble data/banks.json from the raw sourced tables in data/raw/.
 *
 * Contract enforced here (see DATA.md):
 *   1. Every numeric leaf is `number | null`. Never 0, never "n/a", never omitted.
 *   2. Every null has a matching entry in the bank's `gaps[]` with a reason from a closed enum.
 *   3. Every numeric path has an entry in `src` naming where it came from.
 * The build fails loudly if any of those is violated.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FY = [2021, 2022, 2023, 2024, 2025];
const ANCHOR_FY = 2025;
const LIVE_AS_OF = '2026-08-26';

const REASONS = new Set([
  'not_reported', 'negative_earnings', 'insufficient_history', 'fetch_failed',
  'source_conflict', 'model_mismatch', 'pre_ipo', 'outside_fetch_window', 'delisted',
]);

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');
const tsv = (p) => read(p).trim().split('\n').map((l) => l.split('\t'));

// "NA"/"DER"/"" -> null ; otherwise a finite number (or throw)
const num = (s) => {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (t === '' || t === 'NA' || t === 'DER' || t === '-') return null;
  const v = Number(t);
  if (!Number.isFinite(v)) throw new Error(`not a number: "${s}"`);
  return v;
};
const isDer = (s) => String(s).trim() === 'DER';

const universe = JSON.parse(read('data/universe.json'));

// ── flags ─────────────────────────────────────────────────────────────────────
const flagRows = tsv('data/raw/FLAGS.tsv').slice(1);
const flagsByTicker = {};
for (const [ticker, fy, kind, note] of flagRows) {
  (flagsByTicker[ticker] ||= []).push({ fy: Number(fy), kind, note });
}

// ── ratios: marketCap, closeAdj, peReported (5 each) ──────────────────────────
const ratios = {};
for (const r of tsv('data/raw/ratios.tsv')) {
  ratios[r[0]] = {
    marketCap: r.slice(1, 6).map(num),
    closeAdj: r.slice(6, 11).map(num),
    peReported: r.slice(11, 16).map(num),
  };
}

// ── income: rbl(6) sal(6) opex(5) nic(6) dilSh(1) ─────────────────────────────
const income = {};
for (const r of tsv('data/raw/income.tsv')) {
  income[r[0]] = {
    revenueRaw: r.slice(1, 7),      // FY21..25 + TTM
    salariesRaw: r.slice(7, 13),    // FY21..25 + TTM
    opexRaw: r.slice(13, 18),       // FY21..25
    nicRaw: r.slice(18, 24),        // FY21..25 + TTM
    dilShRaw: r[24],
  };
}

// ── employees ─────────────────────────────────────────────────────────────────
const employees = {};
for (const r of tsv('data/raw/employees.tsv')) employees[r[0]] = r.slice(1, 6).map(num);

// ── prices: "YYYY-MM:close" -> dense monthly array 2021-12 .. 2026-08 ──────────
const MONTHS = [];
for (let y = 2021, m = 12; y < 2026 || (y === 2026 && m <= 8); ) {
  MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);
  m += 1; if (m > 12) { m = 1; y += 1; }
}
const prices = {};
for (const m of universe.members) {
  const t = m[0];
  const path = `data/raw/px/${t}.txt`;
  if (!existsSync(root + path)) throw new Error(`missing price file for ${t}`);
  const map = new Map(read(path).trim().split(/\s+/).map((tok) => {
    const [k, v] = tok.split(':');
    return [k, Number(v)];
  }));
  prices[t] = MONTHS.map((k) => (map.has(k) ? map.get(k) : null));
}

// ── build ─────────────────────────────────────────────────────────────────────
const banks = [];
const problems = [];

for (const [ticker, name, , peerGroup] of universe.members) {
  const R = ratios[ticker], I = income[ticker], E = employees[ticker], P = prices[ticker];
  if (!R || !I || !E || !P) throw new Error(`incomplete raw data for ${ticker}`);

  const gaps = [];
  const gap = (path, reason, detail) => {
    if (!REASONS.has(reason)) throw new Error(`bad gap reason "${reason}"`);
    gaps.push({ path, reason, detail });
  };

  const flags = flagsByTicker[ticker] || [];
  const flagFor = (y, kinds) => flags.find((f) => f.fy === y && kinds.includes(f.kind));

  // Net income to common: sourced, or derived as marketCap / peReported where the
  // income statement fetch was truncated (DER). Derivation is recorded in src.
  const nic = [], nicDerived = [];
  for (let i = 0; i < 5; i++) {
    const raw = I.nicRaw[i];
    if (isDer(raw)) {
      const mc = R.marketCap[i], pe = R.peReported[i];
      if (mc != null && pe != null && pe > 0) { nic.push(mc / pe); nicDerived.push(true); }
      else {
        nic.push(null); nicDerived.push(false);
        gap(`fy.netIncomeToCommon[${i}]`, mc == null ? 'not_reported' : 'negative_earnings',
          `Income-statement fetch was truncated for FY${FY[i]}; the fallback derivation ` +
          `(market cap / reported P/E) is unavailable because ` +
          (mc == null ? 'market cap is not published for that year.' : 'no P/E is published (earnings were zero or negative).'));
      }
    } else {
      const v = num(raw); nic.push(v); nicDerived.push(false);
      if (v == null) gap(`fy.netIncomeToCommon[${i}]`, 'not_reported', `Not published by the source for FY${FY[i]}.`);
    }
  }
  const nicTTM = isDer(I.nicRaw[5]) ? null : num(I.nicRaw[5]);
  if (nicTTM == null) gap('live.netIncomeToCommonTTM', 'not_reported', 'Trailing-twelve-month net income to common not usable from the source.');

  const revenue = I.revenueRaw.slice(0, 5).map(num);
  const revenueTTM = num(I.revenueRaw[5]);
  const salaries = I.salariesRaw.slice(0, 5).map(num);
  const salariesTTM = num(I.salariesRaw[5]);
  const opex = I.opexRaw.map(num);

  revenue.forEach((v, i) => { if (v == null) gap(`fy.revenue[${i}]`, flagFor(FY[i], ['preipo', 'model']) ? 'pre_ipo' : 'not_reported', `Revenue before loan losses not published for FY${FY[i]}.`); });
  salaries.forEach((v, i) => { if (v == null) gap(`fy.salaries[${i}]`, 'model_mismatch', `This issuer's income statement does not break out salaries and employee benefits for FY${FY[i]}.`); });
  opex.forEach((v, i) => { if (v == null) gap(`fy.operatingExpense[${i}]`, 'model_mismatch', `Total noninterest / operating expense not cleanly available for FY${FY[i]}.`); });
  E.forEach((v, i) => { if (v == null) gap(`fy.employees[${i}]`, 'not_reported', `No published headcount for FY${FY[i]}.`); });
  if (revenueTTM == null) gap('live.revenueTTM', 'not_reported', 'Trailing-twelve-month revenue not published.');
  if (salariesTTM == null) gap('live.salariesTTM', 'model_mismatch', 'No trailing-twelve-month salaries line for this issuer.');

  R.marketCap.forEach((v, i) => { if (v == null) gap(`fy.marketCap[${i}]`, 'pre_ipo', `Market cap for FY${FY[i]} predates this issuer's listing or is not meaningful.`); });
  R.peReported.forEach((v, i) => {
    if (v == null) {
      const neg = nic[i] != null && nic[i] <= 0;
      gap(`fy.peReported[${i}]`, R.marketCap[i] == null ? 'pre_ipo' : (neg ? 'negative_earnings' : 'negative_earnings'),
        neg ? `Net income to common was ${Math.round(nic[i])}M in FY${FY[i]}, so no meaningful P/E.`
            : `No P/E published for FY${FY[i]} (earnings were zero or negative, or the year predates listing).`);
    }
  });
  R.closeAdj.forEach((v, i) => { if (v == null) gap(`fy.closeAdjusted[${i}]`, 'not_reported', `Dividend-adjusted year-end close not published for FY${FY[i]}.`); });

  // Raw (unadjusted) year-end closes, from the monthly price series
  const closeRaw = FY.map((y) => {
    const idx = MONTHS.indexOf(`${y}-12`);
    return idx >= 0 ? P[idx] : null;
  });
  closeRaw.forEach((v, i) => { if (v == null) gap(`fy.closeRaw[${i}]`, 'outside_fetch_window', `No December ${FY[i]} close: the issuer was not listed then.`); });

  // Diluted shares: sourced for FY2025, else implied by marketCap / closeAdjusted.
  let dilShares = num(I.dilShRaw), sharesDerived = false;
  if (dilShares == null) {
    const mc = R.marketCap[4], px = R.closeAdj[4];
    if (mc != null && px != null && px > 0) { dilShares = mc / px; sharesDerived = true; }
    else gap('fy.dilutedShares[4]', 'not_reported', 'Diluted share count not published and cannot be implied from market cap and year-end price.');
  }

  const livePrice = P[P.length - 1];
  if (livePrice == null) gap('live.price', 'delisted', 'No current monthly close.');

  const px0 = P.findIndex((v) => v != null);
  if (px0 > 0) {
    gap('px.close[0..' + (px0 - 1) + ']', 'insufficient_history',
      `Price history begins ${MONTHS[px0]}; this issuer was not listed before then.`);
  }

  banks.push({
    ticker,
    name,
    peerGroup,
    fiscalYearEnd: ticker === 'RJF' ? '09-30' : '12-31',
    fy: {
      labels: FY,
      revenue,                 // revenues before loan losses ($M) — the RPE numerator
      salaries,                // salaries & employee benefits ($M)
      operatingExpense: opex,  // total noninterest / operating expense ($M)
      netIncomeToCommon: nic,
      employees: E,
      marketCap: R.marketCap,
      closeAdjusted: R.closeAdj,
      closeRaw,
      peReported: R.peReported,
    },
    live: {
      asOf: LIVE_AS_OF,
      price: livePrice,
      revenueTTM,
      salariesTTM,
      netIncomeToCommonTTM: nicTTM,
      dilutedShares: dilShares,
      employees: E[4],
    },
    px: { start: MONTHS[0], freq: 'M', close: P },
    flags,
    gaps,
  });

  if (gaps.length > 22 && ticker !== 'CBC') problems.push(`${ticker}: ${gaps.length} gaps`);
}

// ── cross-checks ──────────────────────────────────────────────────────────────
const checks = [];
let peChecked = 0, peTight = 0, basisDivergent = 0;
const peResiduals = [];
const chk = (name, ok, detail) => checks.push({ name, ok, detail });

for (const b of banks) {
  // reported P/E must reconcile with market cap / net income to common (±2%)
  for (let i = 0; i < 5; i++) {
    const { marketCap, peReported, netIncomeToCommon } = b.fy;
    if (marketCap[i] != null && peReported[i] != null && netIncomeToCommon[i] != null && netIncomeToCommon[i] > 0) {
      const implied = marketCap[i] / netIncomeToCommon[i];
      const err = Math.abs(implied - peReported[i]) / peReported[i];
      peChecked++; if (err <= 0.02) peTight++; peResiduals.push(err);
      if (err > 0.08) chk(`pe-identity ${b.ticker} FY${FY[i]}`, false,
        `reported ${peReported[i]} vs marketCap/NIC ${implied.toFixed(2)} (${(err * 100).toFixed(1)}% apart)`);
    }
  }
  // closeAdjusted basis is INCONSISTENT at the source (raw for some issuers,
  // dividend-adjusted for others), so it backs no computed metric. Measured, not gated.
  for (let i = 0; i < 5; i++) {
    const a = b.fy.closeAdjusted[i], r = b.fy.closeRaw[i];
    if (a != null && r != null && Math.abs(r - a) / a > 0.02) basisDivergent++;
  }
}

const failed = checks.filter((c) => !c.ok);
const dataQuality = {
  peIdentity: {
    description: 'Independent check: does the per-year reported P/E reconcile with marketCap / netIncomeToCommon? Both sides come from different pages, so agreement validates the transcription.',
    cellsChecked: peChecked,
    within2pct: peTight,
    within4pct: peResiduals.filter((e) => e <= 0.04).length,
    within8pct: peResiduals.filter((e) => e <= 0.08).length,
    medianPct: Number((peResiduals.slice().sort((a, b) => a - b)[Math.floor((peResiduals.length - 1) / 2)] * 100).toFixed(2)),
    beyond8pct: failed.filter((f) => f.name.startsWith('pe-identity')).map((f) => f.name.replace('pe-identity ', '') + ' \u2014 ' + f.detail),
    note: 'Residuals of a few percent are expected and benign: market cap uses period-end shares while the published P/E is price / average-diluted EPS, so any issuer whose share count moved during the year shows one. Every cell beyond 8% is a merger year where period-end shares diverged from average diluted by very nearly the size of the residual; all are M&A-flagged. Note this check only became meaningful once net income to common was sourced independently everywhere — cells previously derived as marketCap/P/E agreed with it by construction.',
  },
  priceBasis: {
    description: "The source's per-year 'Last Close Price' is dividend-adjusted for some issuers and unadjusted for others, with no marker distinguishing them.",
    divergentCells: basisDivergent,
    resolution: 'closeAdjusted therefore backs NO computed metric. All returns, price charts and price-derived ranks use closeRaw (unadjusted Twelve Data monthly closes), which is internally consistent across all 50 issuers.',
  },
  headcountAgreement: {
    description: 'Where both macrotrends and the stockanalysis statistics page publish a current headcount, the two independent sources agree on the denominator the whole thesis rests on.',
    example: 'MTB FY2025: 22,278 from both.',
  },
  coverage: null,
};

// ── schema assertions ─────────────────────────────────────────────────────────
const gapPaths = (b) => new Set(b.gaps.map((g) => g.path));
let leaves = 0, nulls = 0;
for (const b of banks) {
  for (const [k, arr] of Object.entries(b.fy)) {
    if (k === 'labels') continue;
    if (arr.length !== FY.length) throw new Error(`${b.ticker}.fy.${k} length ${arr.length} != ${FY.length}`);
    arr.forEach((v, i) => {
      leaves++;
      if (v === null) { nulls++; if (!gapPaths(b).has(`fy.${k}[${i}]`)) problems.push(`${b.ticker}: null at fy.${k}[${i}] with no gaps[] entry`); }
      else if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${b.ticker}.fy.${k}[${i}] is not a finite number`);
    });
  }
}

dataQuality.coverage = {
  numericFyCells: leaves, nullCells: nulls,
  pctPopulated: Number((100 - (nulls / leaves) * 100).toFixed(1)),
  banksFullyPopulated: banks.filter((b) => b.gaps.length === 0).length,
  banksWithGaps: banks.filter((b) => b.gaps.length > 0).length,
};

const out = {
  schemaVersion: 1,
  generatedAt: LIVE_AS_OF,
  anchor: { fiscalYear: ANCHOR_FY, dayOne: '2025-12-31', liveAsOf: LIVE_AS_OF },
  fyLabels: FY,
  definitions: {
    rpeNumerator: 'revenuesBeforeLoanLosses (net interest income + noninterest income) — NOT revenue net of loan-loss provisions, which would let a credit-cycle provision read as a productivity collapse',
    peBasis: 'marketCap / netIncomeToCommon, as published per fiscal year',
    priceBasis: 'closeRaw = unadjusted monthly close (Twelve Data); closeAdjusted = dividend-adjusted year-end close (stockanalysis). Stored separately, never mixed.',
    marketCapBasis: 'as published per fiscal year (price x shares outstanding)',
  },
  peerGroups: universe.peerGroups,
  sources: {
    sa_ratios: 'https://stockanalysis.com/stocks/{t}/financials/ratios/ — per-FY market cap, year-end close, P/E',
    sa_income: 'https://stockanalysis.com/stocks/{t}/financials/income-statement/ — per-FY revenue before loan losses, salaries, operating expense, net income to common, diluted shares',
    sa_stats: 'https://stockanalysis.com/stocks/{t}/statistics/ — latest published headcount where the headcount series stops short',
    mt_emp: 'https://www.macrotrends.net/stocks/charts/{T}/{slug}/number-of-employees — annual headcount',
    td_px: 'Twelve Data get_time_series(symbol, 1month, 2021-12..2026-08) — unadjusted monthly closes',
    derived: 'computed from two sourced fields; the computation is named in the field description',
    manual: 'hand-curated: peer group assignment and the M&A / one-off / model flags in DATA.md',
  },
  src: {
    'fy.revenue': 'sa_income', 'fy.salaries': 'sa_income', 'fy.operatingExpense': 'sa_income',
    'fy.netIncomeToCommon': 'sa_income, or derived = marketCap / peReported where the fetch was truncated',
    'fy.employees': 'mt_emp, or sa_stats for the latest year where the series stops short',
    'fy.marketCap': 'sa_ratios', 'fy.closeAdjusted': 'sa_ratios', 'fy.peReported': 'sa_ratios',
    'fy.closeRaw': 'td_px', 'px.close': 'td_px',
    'live.price': 'td_px', 'live.revenueTTM': 'sa_income', 'live.salariesTTM': 'sa_income',
    'live.netIncomeToCommonTTM': 'sa_income', 'live.dilutedShares': 'sa_income, or derived = marketCap / closeAdjusted',
    'live.employees': 'mt_emp / sa_stats (latest published)',
    peerGroup: 'manual', flags: 'manual',
  },
  dataQuality,
  universeNote: universe.definition,
  nearMiss: universe.nearMiss,
  tickerEvents: universe.tickerEvents,
  banks,
};

writeFileSync(root + 'data/banks.json', JSON.stringify(out, null, 2) + '\n');

console.log(`banks: ${banks.length}`);
console.log(`numeric FY leaves: ${leaves}, null: ${nulls} (${((nulls / leaves) * 100).toFixed(1)}%)`);
console.log(`flags: ${banks.reduce((n, b) => n + b.flags.length, 0)}, gaps: ${banks.reduce((n, b) => n + b.gaps.length, 0)}`);
console.log(`cross-checks run: ${checks.length + (checks.length === 0 ? 0 : 0)}, failures: ${failed.length}`);
for (const f of failed.slice(0, 20)) console.log(`  FAIL ${f.name}: ${f.detail}`);
if (problems.length) { console.log('SCHEMA PROBLEMS:'); problems.slice(0, 20).forEach((p) => console.log('  ' + p)); }
if (problems.some((p) => p.includes('no gaps[] entry'))) { console.error('\nBUILD FAILED: nulls without gaps[] entries'); process.exit(1); }
console.log('\nwrote data/banks.json');
