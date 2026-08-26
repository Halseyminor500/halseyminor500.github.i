# raw/ column schemas  (all $ millions unless noted)

ratios.tsv  (16 cols, tab-separated)
  ticker | marketCap FY21..FY25 (5) | lastClosePriceAdj FY21..FY25 (5) | peReported FY21..FY25 (5)
  NA = not available at source.

income.tsv  (25 cols, tab-separated)
  ticker
  revenuesBeforeLoanLosses FY21..FY25, TTM   (6)   <- RPE NUMERATOR (NII + noninterest income)
  salariesAndBenefits      FY21..FY25, TTM   (6)
  totalNonInterestExpense  FY21..FY25        (5)   <- "Total Operating Expenses" for MS/GS/SCHW-type filers
  netIncomeToCommon        FY21..FY25, TTM   (6)
  dilutedSharesOutstanding FY25              (1)   (millions of shares)

px/<TICKER>.txt  space-separated "YYYY-MM:close", raw (unadjusted) monthly closes from Twelve Data,
  2021-12 .. 2026-08 = 57 points. CBC is short (listed 2025-11) and is padded with nulls at parse time.

employees.tsv  (6 cols)  ticker | employees FY21..FY25
stats.tsv     (8 cols)  ticker | livePrice liveMarketCap liveSharesOutM livePE liveRevTTM liveEmployees liveAsOf
