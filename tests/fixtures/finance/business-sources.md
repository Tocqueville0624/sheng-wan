# Business revenue source fixtures

The HTML files preserve the original primary income-statement table, its referenced
XBRL contexts and units, and additional original current-quarter consolidated facts
from the same filing. Numeric values, labels, dimensions, precision attributes,
subtotals and signs are not edited. These are excerpts, not full filings.

- MCD: [2026 Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/63908/000006390826000073/mcd-20260630.htm), filed 2026-08-07.
- TSLA: [2026 Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/tsla-20260630.htm), filed 2026-07-23.
- IBM: [2026 Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/51143/000005114326000078/ibm-20260630.htm), filed 2026-07-23.

`business-fixtures.ts` provides a reusable unit/browser test helper. Its test-only
Company Facts envelope takes consolidated values from the preserved inline facts;
it does not claim that this envelope was downloaded from the Company Facts API.
The actual production extractors then produce both the consolidated statement and
the business breakdown from these exact source values. No company-specific
partition amounts or manually asserted gross profits are supplied to extraction.

## Primary income-statement row fixtures

`*-statement.html` files keep one reporting-period column of an issuer's primary
income statement: original row order, visible labels, fact names, contexts, units,
scale, sign and declared decimals. Styling, other columns and non-USD units are
omitted. They exercise generic statement reading (`statement-v2.ts`):

- ORCL: [FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/1341439/000119312526277521/orcl-20260531.htm), filed 2026-06-22 — issuer-extension pretax concept and a reported operating-expense total.
- COST: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm), filed 2025-10-08 — cost rows without a reported total.
- V: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1403161/000140316125000089/v-20250930.htm), filed 2025-11-06 — operating-expense total without gross profit.
- PLTR: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1321655/000132165526000011/pltr-20251231.htm), filed 2026-02-17 — gross-profit statement with noncontrolling interests.
- AMD: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm), filed 2026-02-04 — tax benefit, after-tax equity income and discontinued operations.
- TJX: [FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/109198/000010919826000008/tjx-20260131.htm), filed 2026-03-31 — no operating-income or gross-profit line.
- JNJ: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/200406/000020040626000016/jnj-20251228.htm), filed 2026-02-11 — gross profit to pretax profit without an operating-income line.
- ACN: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1467373/000146737325000217/acn-20250831.htm), filed 2025-10-10 — two noncontrolling-interest lines.
- WMT: [FY2026 Form 10-K](https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm), filed 2026-03-13 — net sales plus membership income equal the reported total revenues.
