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
