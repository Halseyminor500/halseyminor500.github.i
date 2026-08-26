# Data: sources, method, and every known limit

Everything the dashboard shows comes from `data/banks.json`. That file is the source of truth;
`index.html` is generated from it and contains no numbers of its own.

---

## 1. The universe

**Top 50 US bank holding companies and savings & loan holding companies by equity market
capitalisation** — effectively the Federal Reserve's FR Y-9C filer population, ranked by market cap.

Built by taking four industry lists (`banks-diversified`, `banks-regional`, `capital-markets`,
`credit-services`), dropping non-US issuers, dropping non-BHC names, and taking the top 50 by
market cap. No single published list works: the "banks" list omits Goldman, Morgan Stanley,
Schwab, Amex and Capital One — five of the seven peer groups — while including roughly thirty
foreign issuers.

**Included** because they are Fed-supervised holding companies: GS, MS, SCHW, AXP, COF, SYF,
ALLY, SOFI, BK/BNY, STT, NTRS, RJF, SF, AMP.
**Excluded**: payment networks (V, MA — not banks), non-BHC brokers and fintechs (HOOD, IBKR,
LPLA, JEF, AFRM, PYPL), and all foreign issuers.

Ranks 51–55, just outside the cut: Hancock Whitney $6.07B, Ameris $6.06B, Atlantic Union $6.05B,
Home BancShares $5.79B, Bank OZK $5.64B.

**Ticker events.** DFS (Discover) merged into COF, May 2025 — Discover's pre-merger history is
*not* attributed to COF. NYCB renamed FLG (Flagstar Financial), 2024 — same issuer, continuous
history. COOP (Mr. Cooper) delisted Oct 2025, excluded.

### Peer groups (hand-assigned; no source publishes this taxonomy)

| Group | n | Members |
|---|---|---|
| Universal / GSIB | 4 | JPM BAC WFC C |
| Capital Markets & Wealth | 6 | MS GS SCHW RJF SF AMP |
| Trust & Custody | 3 | BNY STT NTRS |
| Consumer Finance & Digital | 5 | AXP COF SYF ALLY SOFI |
| Super-Regional | 10 | PNC USB TFC FITB HBAN MTB CFG RF KEY FCNCA |
| Regional | 22 | the remainder |

Trust & Custody has only three members, so peer-normalised ranks for those three are unstable.
The dashboard says so in the model note.

---

## 2. Sources

| Tag | Source | Fields |
|---|---|---|
| `sa_ratios` | `stockanalysis.com/stocks/{t}/financials/ratios/` | per-FY market cap, year-end close, P/E |
| `sa_income` | `stockanalysis.com/stocks/{t}/financials/income-statement/` | per-FY revenue before loan losses, salaries & benefits, total noninterest/operating expense, net income to common, diluted shares, plus the TTM column |
| `sa_stats` | `stockanalysis.com/stocks/{t}/statistics/` | latest published headcount, where the headcount series stops short |
| `mt_emp` | `macrotrends.net/stocks/charts/{T}/{slug}/number-of-employees` | annual headcount |
| `td_px` | Twelve Data `get_time_series(symbol, 1month, 2021-12 → 2026-08)` | unadjusted monthly closes |
| `exa_news` | curated web-search snapshot (Exa), Jan 2025 – Aug 2026 | public AI-deployment announcements and workforce-reduction statements, one verified source URL per row — `data/raw/news.tsv` |
| `manual` | hand-curated | peer group, M&A / one-off / model flags |

Direct access to SEC EDGAR, Stooq and Yahoo is blocked by this environment's egress policy,
so those were not used.

---

## 3. Three decisions that materially change the numbers

### 3.1 Revenue means revenue *before* loan losses

The aggregator's headline "Revenue" line for a bank is **net of the provision for loan losses**.
For M&T in FY2025: `Revenues Before Loan Losses 9,690 − Provision 505 = Revenue 9,185`.

Using the net figure as the revenue-per-employee numerator would let a credit-cycle provision
spike read as a collapse in productivity — the opposite of what this dashboard measures. So the
numerator is **Revenues Before Loan Losses = net interest income + noninterest income**
(6,948 + 2,742 = 9,690 ✓), which is also the standard definition of bank total revenue.

Worth 5.5% on M&T alone, which is enough to move ranks.

### 3.2 Prices are unadjusted throughout

The aggregator's per-year "Last Close Price" turned out to be **dividend-adjusted for some
issuers and raw for others**, with nothing marking which. It therefore backs no computed metric
here. Every return, price chart and price-derived rank uses `closeRaw` — unadjusted monthly
closes from one API, internally consistent across all 50 issuers. `closeAdjusted` is stored only
so the divergence is visible and auditable.

Consequence: reported returns are **price returns, not total returns**. Dividends are not
reinvested. For a sector yielding 2–4%, that understates long-run performance roughly uniformly,
so ranks are affected far less than levels.

### 3.3 Revenue per employee is annual, and cannot be otherwise

Headcount is published once a year in the 10-K. There is no quarterly series. So the
revenue-per-employee series is **annual (FY2021–FY2025) plus one current point**, and the
correlation index is drawn as stepped markers rather than a line — there is no intra-year
reading to interpolate.

---

## 4. The missing-data contract

Enforced by `scripts/assemble.mjs` and re-checked by `build.mjs`; the build fails if violated.

1. Every numeric leaf is `number | null`. Never `0`, never `"n/a"`, never omitted.
2. **Every `null` carries an entry in that bank's `gaps[]`** with a written reason drawn from a
   closed enum: `not_reported · negative_earnings · insufficient_history · fetch_failed ·
   source_conflict · model_mismatch · pre_ipo · outside_fetch_window · delisted`.
3. Every numeric path has an entry in `src` naming where it came from.

Nothing is imputed, averaged, or carried forward. A missing value renders as `—` with its reason
on hover, and its bank drops out of that ranking — the effective `K` shrinks rather than the bank
being given a substitute number.

**Coverage: 97.1% of 2,250 fiscal-year cells populated; 65 null, every one explained.**

The 65 remaining nulls sit in nine issuers and fall into six reasons: `model_mismatch` 25
(AMP and SF file non-bank income statements with no salaries line; SF's expense lines are
internally inconsistent), `not_reported` 17, `pre_ipo` 12 (CBC, listed Nov 2025),
`negative_earnings` 10 (no P/E where earnings are ≤ 0), `outside_fetch_window` 4, and
`insufficient_history` 1. **Headcount is complete: 250 of 250 bank-years.** So is the live
snapshot — all 50 issuers have a TTM net income to common and a diluted share count, so the
current P/E is computed on the same basis for every bank in the universe.

Two derivations remain and are labelled as such in `src`:
- **Net income to common, SF FY2021–FY2022** — derived as diluted EPS × diluted shares, because
  the standardised statement maps operating income into the net income line for those two years
  and returns a negative figure in a profitable year. The derivation reproduces SF's *reported*
  FY2023–FY2025 net income to within 0.3%, which is what justifies it.
- **Headcount for FY2021** on some issuers — derived from the source's own stated
  percentage change for 2022 where the 2021 level itself was not listed. Flagged `derived`.

Earlier builds derived net income to common as `marketCap ÷ reported P/E` wherever an
income-statement fetch had been truncated. Every one of those cells is now sourced directly from
the income statement. That removes a circularity as well as a gap: a derived cell agreed with the
P/E identity below *by construction* and so could not be checked by it.

---

## 5. Cross-checks

### P/E identity — an independent check on the transcription

For each bank-year, the published P/E was reconciled against `marketCap ÷ netIncomeToCommon`.
The two sides come from **different pages**, so agreement is evidence the numbers were
transcribed correctly.

**181 of 235 checkable cells agree within 2%, 206 within 4%, 231 within 8%; the median residual
is 0.07%.**

Those figures are *worse* than earlier builds reported (207 of 235) and that is the point: the
cells that used to pass came from net income derived as `marketCap ÷ P/E`, so they agreed with the
identity by definition. Now that every cell is independently sourced, the check finally tests
something.

Residuals of a few percent are expected and benign: market cap uses period-end shares while the
published P/E is price ÷ *average diluted* EPS, so any issuer whose share count moves during the
year shows a residual of roughly that size. AMP sits at 7.1–7.6% in **every** year, which is the
signature of a steady buyback rather than a transcription error.

Four cells exceed 8%, all four explained by that same mechanism and all four flagged:

| Cell | Residual | Cause |
|---|---|---|
| COF FY2025 | 15.5% | Discover merger, discontinued operations |
| HBAN FY2021 | 12.2% | merger year |
| GBCI FY2021 | 11.5% | Altabancorp closed Oct 2021 — 110.7M period-end shares vs 99M average diluted (+11.8%), which is the entire residual |
| GBCI FY2025 | 8.2% | Bank of Idaho and Guaranty — 130.0M period-end shares vs 120M average diluted (+8.3%), likewise |

### Two-source headcount agreement

Where both the headcount series and the statistics page publish a current figure, they agree on
the denominator the entire thesis rests on. M&T FY2025: **22,278 from both sources.**

### Internal identities

`revenueBeforeLoanLosses − provision = revenue` and
`netInterestIncome + noninterestIncome = revenueBeforeLoanLosses` were checked per bank-year.

---

## 6. Derived signals

Four signals are computed on top of the raw series. Each has a stated blind spot, because a
signal whose failure mode is unstated is a trap.

### Jaws and the machine signature

`jaws = revenue growth − expense growth` over one fiscal year (the live snapshot uses
FY2024→FY2025: expense lines have no published TTM). The **machine signature** is four
conditions at once — jaws positive, headcount down, **comp per employee held** (within 0.5% or
rising), and no M&A/one-off flag in the window. The point of the combination is that each common
*fake* efficiency gain breaks a different light: a rate-cycle revenue windfall usually arrives
with cost growth (breaks jaws), growth-by-hiring breaks the headcount light, wage suppression
breaks comp-per-head, and outsourcing moves salaries into vendor expense — comp per head can
even rise while jaws collapses. All four together is the accounting shape of automation.
**Blind spot:** a one-year window; a bank can pass it once by coincidence. Two consecutive
matches mean far more than one, and the panel is recomputed per snapshot so that history is one
click away.

### Conviction (headcount-decline streak)

Consecutive fiscal years of falling headcount ending FY2025, counting only years without an
M&A/one-off flag. WFC has shrunk four straight clean years; USB, ALLY, ZION and VLY three; BNY
two. Shrinking outside a merger, repeatedly, is a decision — the "difficult employee retainment
decisions" the thesis says full dedication requires. **Blind spot:** the flag set covers
mergers and disclosed one-offs, not every small divestiture; and a streak says nothing about
*why* headcount fell until read next to revenue (which is what Thrust is for).

### Nitro — the strongest-signal composite

`nitro = 0.35·pctRank(thrust) + 0.35·pctRank(accel) + 0.15·(signature lights ÷ 4)
+ 0.15·(min(streak, 3) ÷ 3)`, in [0,1]. Realized go-fast evidence — Thrust and its
acceleration — carries 70%; the corroborating machine-signature pattern and the conviction
streak 15% each. Null whenever any component is null, same no-imputation rule as the other
composites. The top ten are the **Nitro 10** panel. **Blind spot:** a weighted blend is a
judgment, not a measurement — the weights are stated so they can be argued with.

### The Google Trends hand-off

The Nitro 10 panel links out to Google Trends with a pre-built comparison — colloquial bank
names ("wells fargo ai", "jpmorgan chase ai") from a hand-curated 50-ticker map, United
States, past 12 months, web search. Trends compares at most five terms per chart, so the ten
ship as two clean charts of five (ranks 1–5 and 6–10); each chart is normalised to its own
strongest term, so levels compare within a chart, not across the pair. This is deliberately **outbound**: search interest is
Google's data, normalised within the query by Google — a secondary source this project neither
collects, stores, nor maintains, so it carries no consistency burden here. **Blind spot:**
search interest mixes customers, job-seekers and news cycles; it is a mining lens for the
short-listed names, never a ranking input.

### The announcement flag (say vs do)

A hand-curated snapshot of public statements, January 2025 – August 2026: `kind=ai` rows are
the bank itself deploying AI (internal copilots, customer assistants, agentic programs, stated
AI efficiency targets — *not* investing in AI startups or conference talk), `kind=workforce`
rows are concrete reductions, attrition-as-policy or severance programs. Every row carries a
date and one verified source URL and lives in `data/raw/news.tsv`; nine banks have no ai row
(EWBC, WTFC, ONB, CBSH, BOKF, PB, CBC, GBCI, UBSI). **Blind spots, stated on the page itself:**
"quiet" means the sweep found nothing public, never that nothing is happening; the snapshot is
manual and dated, not a live feed; and announcement *intensity* is not scored — one strong
primary source counts the same as ten.

## 7. Distortion flags — 70 across 30 banks

Mergers and one-offs move headcount and revenue for reasons that have nothing to do with
productivity. Flagged bank-years are **excluded from every screen** and marked in the table.
The full list with per-bank notes is in `data/raw/FLAGS.tsv` and travels into `banks.json`.

The ones that would most distort the thesis if left unflagged:

| Bank | Year | What happened |
|---|---|---|
| COF | 2025 | Discover merger — headcount +45%, a $20.7B provision build, and a P/E of 60× that is merger accounting, not valuation |
| TFC | 2024 | Sold Truist Insurance — headcount −25% by divestiture, not productivity; revenue also carries a −$6.7B securities repositioning loss |
| PNFP | 2025 | Synovus merger — headcount +135% |
| COLB | 2023, 2025 | Umpqua (+144% headcount), then Pacific Premier |
| FCNCA | 2022, 2023 | CIT (+56%), then Silicon Valley Bridge Bank with a $9.8B bargain-purchase gain and a P/E of 1.8× |
| FLG | 2022–2024 | Flagstar merger (+166%), Signature Bank purchase, then the CRE crisis and a reverse split |
| KEY | 2024 | Securities repositioning: a −$1.86B loss cut revenue-before-provision from ~$7.2B to $4.6B |
| MTB | 2022 | People's United — headcount +29.8% |
| UMBF, SSB, ONB, WBS, VLY | various | acquisitions of 13–63% of revenue |

### Known model mismatches

- **AMP, CBC** file non-bank income statements: no revenue-before-provision line and no separate
  salaries line. Total revenue is used as the numerator and expense derived as revenue minus
  operating income. Comp-per-employee is unavailable for them.
- **SF (Stifel)**: the standardised income statement is internally inconsistent (SG&A
  double-counts cost of revenue; operating income is reported negative in profitable years, and
  for FY2021–FY2022 that negative figure is what lands in the net income line). Expense and salary
  lines are recorded unavailable; net income to common for those two years is derived from diluted
  EPS × diluted shares, validated against the three years the source reports correctly.
- **CBC (Central Bancompany)** listed November 2025. It has ten months of price history and no
  pre-listing fundamentals. Its pre-2025 "market cap" on the source reflects a pre-IPO share
  structure and is recorded as unavailable rather than transcribed. It is retained because it is
  genuinely in the top 50 by market cap today; dropping it would be survivorship bias.
- **RJF** runs an **October–September fiscal year**. Its "FY2025" ends 30 Sep 2025, not 31 Dec.
  Recorded in `fiscalYearEnd` and not silently aligned to the others.
- **FNB FY2025 (TTM)**: the source's TTM net-income-to-common cell reads 318 against a TTM net
  income of 604 with no preferred shares outstanding, and contradicts its own TTM diluted EPS.
  The figure used here is 603.72, corroborated by diluted EPS × diluted shares = 604.8.
- **CBC headcount** is a definition artefact, not a workforce: part-time staff are counted only
  from FY2025 (271 of 3,036), and FY2024 drops 18.7% with no disclosed reorganisation. Its
  headcount change across 2023–2025 should not be read as productivity.
- **BNY FY2025 headcount is 48,100** (10-K, 31 Dec 2025). An earlier build used 46,500 from the
  statistics page — a mid-2026 figure, and so not comparable to the fiscal-year-end counts used
  for the other 49 issuers.

---

## 8. Regenerating

```bash
node scripts/assemble.mjs   # data/raw/*.tsv + data/raw/px/*.txt  ->  data/banks.json
node build.mjs              # data/banks.json + src/index.template.html  ->  index.html
node scripts/verify.mjs     # drives index.html in Chromium; 23 assertions
```

`data/raw/SCHEMA.md` documents every raw column. To add a fiscal year: append to `fyLabels` **and
to every FY array** — they are index-aligned, and `build.mjs` fails the build on a partial append.
Restated prior-year figures are expected and should be reviewed in the diff, not auto-accepted.

Open `index.html?selftest=1` for the 29 in-page assertions, including values pinned to
hand-verified figures (`RPE(MTB, 2025) = $434,958`, `efficiency ratio = 56.69%`, `P/E = 11.47`).

---

## 9. What this dashboard cannot tell you

- **Revenue per employee is not a direct measure of AI adoption.** It is a proxy. A bank can lift
  it by selling a low-margin business, outsourcing staff to a vendor, or a favourable rate cycle —
  none of which is AI. The Thrust and comp-per-employee columns exist to help separate those
  cases, not to settle them.
- **Level is mostly business model.** A wealth manager structurally clears more revenue per head
  than a branch network. That is why peer-normalisation is one click away and why *change*
  (Thrust) carries more signal than level.
- **Five annual points is a short series.** Second differences from three numbers, one of which
  may be merger-contaminated, carry little information — which is why acceleration renders as a
  three-state chip with a wide dead band, never a decimal.
- **Headcount is a blunt denominator.** Full-time-equivalents, contractors and offshore staff are
  counted differently across issuers, and definitions change between filings.
- **AI-specialist hiring cannot be measured honestly from free sources.** LinkedIn and the job
  boards block systematic collection, and per-bank career sites sit on a dozen different
  applicant-tracking systems with no stable coverage across all 50. The commercial datasets
  that do cover this — Revelio Labs, LinkUp, Lightcast — are the upgrade path if this monitor
  ever warrants a data budget. A half-covered column would be worse than none, so there isn't
  one.
- **Forward guidance is not extracted.** Banks guide on net interest income, fees and expenses
  (mostly in Q4/Q1 materials), and the guidance that would confirm this thesis is specific:
  expense growth guided *below* inflation together with positive operating leverage, which is
  management underwriting its own efficiency gains. That lives in decks and transcripts that
  cannot be collected reliably here; it is the one thing worth reading by hand each January.
- Not investment advice.
