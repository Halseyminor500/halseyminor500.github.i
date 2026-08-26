# The Efficiency Ledger

**Revenue per employee, across the 50 largest US banks — and whether the market has priced it yet.**

→ **[Open the dashboard](./index.html)**

---

## The thesis

If a bank is genuinely implementing AI, it shows up as more revenue carried by fewer people. The
market should reward that with a higher multiple. This dashboard tests that claim, and finds the
banks where the market hasn't caught on.

It is built to be falsifiable. The headline stat is the Spearman rank correlation between
revenue-per-employee rank and P/E rank across the universe, shown next to the 5% significance
threshold for that sample size. If the market has priced efficiency, that number clears the
threshold. **Right now it does not** — which is what makes the thesis an opportunity rather than
something already arbitraged away.

## What's in it

- **The ledger** — all 50 banks, ordered by market cap, every column sortable both ways. Revenue
  per employee and its rank, Thrust, comp per head, efficiency ratio, P/E and its rank, the signed
  Gap, Leader score, and the Correlation index on the far right.
- **Correlation index** = `1 − |rank difference| ÷ (K−1)`. It is 1.0 when the market has placed a
  bank exactly where its efficiency says it should be — *including a laggard correctly priced as a
  laggard* — and 0 when the two are maximally crossed. Because that means a 1.0 is not by itself a
  buy signal, **Leader score** (near the top of both) and **Gap** (signed: positive = efficient but
  cheap) sit beside it.
- **Thrust** — the year-over-year change in revenue per employee, with a three-state
  building/flat/fading chip for its acceleration.
- **Three charts** — price, correlation and multiple on one shared timeline; rank migration from
  efficiency rank to price rank; and revenue growth against headcount growth, where the north-west
  quadrant is the whole thesis in one picture.
- **Four screens** — Coiled springs (improving, cheap, and the price hasn't noticed), More with
  less, Best & worst correlated, Greatest opportunity.
- **Toggles** — six snapshots (FY2021–FY2025 and now), rank across all 50 or within peer group,
  raw or growth-adjusted P/E, and 1/2/3-year windows. Every view is a shareable URL.

## Two places this departs from a naive build

**No dual-axis chart.** Two auto-fitted y-scales on one frame can be slid to imply almost any
correlation. Price, correlation and P/E are stacked panels on one shared timeline instead, with
the index axis pinned to 0–1.

**Revenue means revenue before loan losses.** The obvious "Revenue" line for a bank is net of
loan-loss provisions; using it would make a credit-cycle provision spike read as a collapse in
productivity. See [DATA.md](./DATA.md) §3.1.

## Data honesty

Nothing is imputed, averaged, or carried forward. 93.5% of fiscal-year cells are populated; the
147 that are missing each carry a written reason, render as `—`, and drop their bank out of that
ranking rather than being given a substitute number. 62 merger and one-off flags exclude distorted
bank-years from every screen. The published P/E reconciles with market cap ÷ net income to common
in 207 of 235 cells within 2%, which is an independent check on the transcription.

Full method, sources, and every known limit: **[DATA.md](./DATA.md)**.

## Build

```bash
node scripts/assemble.mjs   # raw tables -> data/banks.json
node build.mjs              # + template -> index.html
node scripts/verify.mjs     # 23 browser assertions
```

`index.html` is fully self-contained — no CDN, no fonts, no network at runtime. It works from
`file://`, over email, on GitHub Pages, or pasted anywhere. `data/banks.json` is also served
standalone if you want the numbers without the interface. Open `index.html?selftest=1` for 27
in-page assertions.

Not investment advice.
