# Business revenue source fixtures

## Operating costs and separately reported gains

- APD: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/2969/000000296925000055/apd-20250930.htm), filed 2025-11-20. The preserved primary table contains five cost lines and two separately reported operating gains. Equity-affiliate income follows operating income and precedes tax; discontinued operations and minority income follow tax.
- APD: [2026 Q3 Form 10-Q](https://www.sec.gov/Archives/edgar/data/2969/000000296926000036/apd-20260630.htm), filed 2026-07-30. The excerpt preserves explicitly tagged zero activism costs and zero sale-of-business gain as well as the other operating gain. Each business revenue branch remains proportional to reported revenue.

The `apd-*-operating-statement.html` excerpts preserve the complete original
primary and business-revenue tables, referenced contexts/units and DEI metadata.
Headers record the whole-document hashes and original table indexes. No source
value, label, scale or sign is edited. The new source ledger records each cost
and gain separately; a gain never enters the cost-component partition.

## Signed statements and shareholder allocations

- MRNA: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1682852/000168285226000033/mrna-20251231.htm), filed 2026-02-20. Reported operating costs exceed revenue; positive tax expense increases the net loss.
- AXON: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1069183/000162828026011360/axon-20251231.htm), filed 2026-02-25. Operating loss becomes positive pretax income after nonoperating items; the reported tax benefit increases net income.
- F: [2026 Q2 Form 10-Q](https://www.sec.gov/Archives/edgar/data/37996/000003799626000156/f-20260630.htm), filed 2026-07-29. Consolidated net loss and common-shareholder loss remain separate, with explicitly reported noncontrolling income between them. Dimensioned Ford Credit expenses are not treated as nondimensional cost components.
- HPE: [FY2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1645590/000164559025000130/hpe-20251031.htm), filed 2025-12-18. The excerpt also preserves an original independent nondimensional `NetIncomeLoss` fact corroborating the primary statement's same-amount diluted subtotal. That subtotal is never equated with parent income merely from its diluted tag. The reported preferred dividend leads from positive parent income to negative common-shareholder income.

These `*-signed-statement.html` files keep entire original primary income and
business-revenue tables, relevant contexts/units, balanced DEI metadata, and any
required independent source corroboration. Their headers record the original
document hash and table indexes. No numeric amount or financial label is edited.
The generic reader supplies actual business amounts, losses and allocations;
tests assert exact conservation and exported signed values.

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

## Source-current reported gross-profit fixtures

The KO, GRMN, LII, MAS and VLTO `2026-business-statement.html` excerpts retain
the complete original primary income and business-revenue tables, referenced
contexts/units and balanced nested DEI metadata. Their headers record the exact
source URL, original table indexes, filing date and whole-document SHA-256.
They exercise first imports without a Company Facts period, exact reported gross
profit, explicit minority attribution and both row/column revenue matrices.
LII includes signed operating gains and pre-operating equity income; MAS's SG&A
line does not exactly equal gross profit less operating income. Their calculated
net totals are labeled as such without manufacturing expense branches.

The INTC and BDX signed excerpts preserve full original primary tables and referenced
contexts/units. Their original-document hashes and table indexes are in the headers.
INTC's large non-operating loss must not intersect operating-expense detail ribbons;
BDX's negative source rounding must not intersect the revenue-to-cost ribbon.
Neither source excerpt supplies a missing business partition.

- INTC: [Q2 FY2026 Form 10-Q](https://www.sec.gov/Archives/edgar/data/50863/000005086326000157/intc-20260627.htm), filed 2026-07-24.
- BDX: [Q2 FY2026 Form 10-Q](https://www.sec.gov/Archives/edgar/data/10795/000001079526000026/bdx-20260331.htm), filed 2026-05-07.

The APD operating excerpts preserve original FY2016, FY2021 and FY2025 comparative/current primary tables and Q3 FY2026, referenced contexts/units and fiscal metadata. FY2021 retains nested numeric facts for the annual and quarter facility-closure loss. FY2016 retains continuing and discontinued NCI as distinct original lines and has no asserted business partition. The CRL FY2025/Q2 FY2026 excerpts preserve the primary tables, including service/product revenue and costs under their original exclusive contexts. Each header records the original whole-document SHA-256, table indexes and filing date. No financial cell, sign or scope was altered.

- APD-2016: [original source statement](https://www.sec.gov/Archives/edgar/data/2969/000000296918000044/apd-10xkx30sep2018.htm), filed 2018-11-20.
- APD-2021: [original source statement](https://www.sec.gov/Archives/edgar/data/2969/000000296923000047/apd-20230930.htm), filed 2023-11-16.
- CRL-2025: [original source statement](https://www.sec.gov/Archives/edgar/data/1100682/000110068226000022/crl-20251227.htm), filed 2026-02-18.
- CRL-2026-Q2: [original source statement](https://www.sec.gov/Archives/edgar/data/1100682/000110068226000118/crl-20260627.htm), filed 2026-08-05.

## Albemarle original business revenue

These excerpts preserve the original complete primary income-statement table and its original heading (including heading tables), the complete business table, and every referenced original context and unit. All monetary cells, comparative/YTD columns, source coordinates, signs, scales and precision declarations retain their original bytes. The tests independently transcribe reported USD-thousand values, verify the full partition against primary net sales, and reject altered amounts, dates, classifications, corporate scope, subtotals and missing rows.

| Fixture                                          | Original SEC filing                                                                                            | Original primary / business table | Whole-document SHA-256                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `alb-fy2017-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591320000040/a1231201910-kdocument.htm) | 200 / 367                         | `ad1e85395676453d0556c92d41146e10ff31b50335444621c4283cb1bb6af4b9` |
| `alb-fy2018-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591321000018/alb-20201231.htm)          | 106 / 212                         | `c1a849845ac2bd78ae82e8118c91072cfc5be084efefb3032aba3c543c160a0a` |
| `alb-fy2019-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591322000027/alb-20211231.htm)          | 134 / 240                         | `61a04cf0ff5e028440752e68044e72ecde010b8d4a333ada14e646b2b4ee191c` |
| `alb-fy2022-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591325000026/alb-20241231.htm)          | 149 / 263                         | `f2c6c5d18f5e485ce701b08eaef529ba1334ac44ec2ff9e203045c7074d029f0` |
| `alb-fy2025-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591326000018/alb-20251231.htm)          | 148 / 271                         | `93314232658914833593a5d25c1409fbed7d897447c8f78475345a4056bd1cd4` |
| `alb-2020-q2-business-revenue.html`              | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591321000149/alb-20210630.htm)          | 7 / 22                            | `3e9bafe2687bc70a1465147a1da43d4f997bcbbecd8230066c25058f69fd0e97` |
| `alb-2022-q1-business-revenue.html`              | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591323000115/alb-20230331.htm)          | 7 / 23                            | `a4a2dffd3f6f7f40bba676abb9941cf1f963a23bf83d1cadf44c71e1a3e88a16` |
| `alb-2025-q1-business-revenue.html`              | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591326000072/alb-20260331.htm)          | 7 / 44                            | `7fa57d9f65788010b348ebc5600c2f06bdfa6953a56c037bd4f036f6c46e877d` |
| `alb-2026-q2-business-revenue.html`              | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591326000102/alb-20260630.htm)          | 7 / 44                            | `f1973e64d18864c6c496c16d5cc2ee7564837c3d08281014f8c80cad96622c4a` |
| `alb-2025-q3-business-revenue.html`              | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591325000162/alb-20250930.htm)          | 7 / 42                            | `b899c608d7c3b6398321b584ffec41eae86d70b469f8ac552e22a2e27202ac02` |
| `alb-fy2021-original-2022-business-revenue.html` | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591323000039/alb-20221231.htm)          | 140 / 246                         | `13599e33de461540f4c58d33e300a76dfd16253ea446fd6b6f33e64867587aa5` |
| `alb-fy2022-original-2022-business-revenue.html` | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591323000039/alb-20221231.htm)          | 140 / 246                         | `13599e33de461540f4c58d33e300a76dfd16253ea446fd6b6f33e64867587aa5` |
| `alb-fy2021-business-revenue.html`               | [Original filing](https://www.sec.gov/Archives/edgar/data/915913/000091591324000016/alb-20231231.htm)          | 148 / 257                         | `3f6a5bd7ffefdbb2c4b03d8580b7579d3c0b4306c552d2460cc0e9d1b6e4b72c` |

The original 2022 annual filing declares fiscal-year focus 2021, although its report end, cover and primary 2022/2021/2020 columns identify 2022. Tests retain that original metadata and exercise the finite source-specific label correction, including preservation of the actual 2021 history. The FY2021 excerpt from the original 2023 filing includes the reported segment subtotal and All Other amount; neither is inferred from a residual. These inline excerpts do not claim coverage of the older separate-XBRL reports.
