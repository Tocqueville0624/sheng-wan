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

## AMETEK original complete EIG / EMG closing revenue rows

These are unchanged, bounded original income-statement and business-table excerpts, including their original headings, contexts, units and nested fiscal metadata. Every original EIG, EMG and Total column is retained, including quarter and cumulative columns. The original primary statement independently corroborates consolidated net sales; geography, product and transfer-timing intersections are excluded from the business partition. Annual IncludingAssessedTax and ExcludingAssessedTax QNames remain distinct. File-level source coordinates in the actual SEC document differ from the compact fixture coordinates; the original table indices and full-document hashes below identify the preserved source. No business gross profit, corporate amount or missing historical value is inferred.

- `ame-fy2017-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000119312520043133/d878806d10k.htm), original tables 88 / 99; whole document SHA-256 `f65e1d4e0d86e9ad52d172b3a90875828acec1ba2b15d724c4b2c32170d0f3e3`; unchanged excerpt SHA-256 `ff4033cc4761ecd88b2e55349bbab3c7d21fccdac888e884053fc1f1d28ad7b9`.
- `ame-fy2021-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786824000009/ame-20231231.htm), original tables 19 / 28; whole document SHA-256 `5854ae13872dbf29be1e2a13c5159f79c18fd922e4456040e0a9b3176ab6ab06`; unchanged excerpt SHA-256 `a0a507f5d57afaef111d0003eb7099e1303a0130e7e16f0546da749d45cc519b`.
- `ame-fy2025-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786826000016/ame-20251231.htm), original tables 20 / 28; whole document SHA-256 `74fdc37a6dd7d270ef35d51350590e20fd496664c75c231cdaf4eaa558215401`; unchanged excerpt SHA-256 `a7d9a4faa3877414ad8c4528eb4487d206fcaa9913bb978a3f1e3143c387f146`.
- `ame-2020-q1-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786821000019/ame-20210331.htm), original tables 7 / 16; whole document SHA-256 `1e1ae9d9b6e882f196da942982cd778aa95b679b94bc9cfe3c58b64f3e51564f`; unchanged excerpt SHA-256 `869e47d7c022d3425274d6dcbc182adf593efc9d1e1544302ba291cea3526d46`.
- `ame-2023-q2-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786824000048/ame-20240630.htm), original tables 7 / 14; whole document SHA-256 `87a6d7d15fb266a8bf87dae9526913d6553b1fce012a5392f648745f10bc7f07`; unchanged excerpt SHA-256 `8f6db0125e54e7a17821aa9e6aa00c47e0176894cf977f8817a83fc46cbc8bbd`.
- `ame-2026-q1-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786826000144/ame-20260331.htm), original tables 7 / 14; whole document SHA-256 `aa9a19d28f6825f02ed8ced57821e8344d867dc1e1b1c107ff81f63f955f94a5`; unchanged excerpt SHA-256 `5a48f8efb70d7022e51e1a4a180d59b48a42584052311595d724e434483ae694`.
- `ame-2026-q2-business-revenue.html`: [original filing](https://www.sec.gov/Archives/edgar/data/1037868/000103786826000175/ame-20260630.htm), original tables 7 / 16; whole document SHA-256 `543a1adef3bdd9265aa115bf2b8bd8b9a2755c0ce6a747e25ede06b36959e4fb`; unchanged excerpt SHA-256 `8b7af4976f6a9470144aed4f615ac652e370ae68815e0512c3efc6d793f92c42`.

## Original separate XBRL declaration excerpts

These bounded original XML excerpts retain the actual source root, namespace bindings, selected declarations and all referenced contexts/units in original source order. They contain no generated financial facts or inline markup. Declaration decoding alone does not establish an HTML row join, business partition, graph or cloud import. Monetary values, nils, precision copies, original signs and currencies remain distinct.

| Excerpt                       | Original instance                                                                                   | Whole source SHA-256                                               | Excerpt SHA-256                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ame-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/ame-20181231.xml) | `5e15fd1fd79d8290466c06f1235c1af84a9ae53a43564940bec9274410f3ddea` | `56986f27159306bb194c459d63ce13d4e957ed3c65085d54b5c6c82ccf676fe6` |
| `alb-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/alb-20181231.xml)  | `cfc362a9b6bbfe222887cc21700e02eff8db1e8a4910082a3958dfaa4e69d385` | `eb4e45b6a225d49452c629fac21d233acb63b32959acbea8afa2ff3f4264c874` |
| `bax-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/10456/000156459019003727/bax-20181231.xml)   | `cb24cc02b28f79875381c3ef4440db8aef02c77993b9af437863d4365cc3781c` | `2bc2153228b42629f703865e93384dde1c3a95e049f9caff45561185c3f27716` |
| `fds-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/1013237/000143774918019028/fds-20180831.xml) | `dd34d1336c1edcb961f5f65dd7351fa81b8f6d08d497da1225d24a0f195a19e8` | `c7440b3d51734ec757956e862ca08801876c4584dc8b4dcf8a689a8bbe3da4f9` |
| `es-original-standalone.xml`  | [SEC original](https://www.sec.gov/Archives/edgar/data/72741/000007274119000017/es-20181231.xml)    | `b00674780c88c637fa716c5dc8491c1abd0c4d0fd4bd4677f11f54aa129f194d` | `51dbacc035be03eaa70f2289a318d7d213af83f9df48191f84b169afe2af7e57` |
| `tsm-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/1046179/000119312519108390/tsm-20181231.xml) | `4e718989b347437a95d9b931b5978ed56e546dea6f2dbe28a47a14cf8e400dc2` | `87001125c447f2447e97fbc015d9b5f635c83fe26f672d8eea433550889e603d` |
| `hst-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/1070750/000156459019004191/hst-20181231.xml) | `d75c171a1139b296bf6b1ee85518ba7e686b90aba4fd5255b66249bb77a013f2` | `7914c1d3a3bcf4dd477fc1fcf84ef5993b83e9247cf40bbd264e23539e25478a` |
| `cat-original-standalone.xml` | [SEC original](https://www.sec.gov/Archives/edgar/data/18230/000001823019000034/cat-20181231.xml)   | `42243111f02e777a5509f2dcbcaa820c32d03167643cda03c681e818f6afc9d9` | `411ac4af814566bc626bc3ebf96d505d16766a65024885c64748ae21e287fcf1` |

AMETEK’s FY2016 closing geography-by-business row reports EIG $2,360,281,000 and EMG $1,479,806,000, exactly matching the original XML. Its MD&A reportable-business rows instead show $2,360,285,000 and $1,479,802,000. Both totals equal $3,840,087,000. This discrepancy remains recorded for scope review; these fixtures do not reinterpret it as a typo, reclassification or balancing adjustment.

## Original separate XML / physical annual cell joins

These unchanged original table/paragraph and XML excerpts exercise explicit calendar-year annual layouts. The join preparation keeps visible signs and XML signs separate, matches the exact QName/date/business scope before comparing values, retains original missing dashes, and rejects conflicting precision copies. Albemarle's original FY2016 primary statement contains 19 separately checked monetary rows; its five business/corporate rows and total remain distinct. AMETEK's original closing business row agrees with the XML and independent primary total; the separately documented MD&A discrepancy remains unresolved. These joins do not assign business meanings, prove a complete accounting graph, or establish runtime/cloud coverage. Whole-source checks are separate from compact-fixture tests.

| Excerpt                                             | Original source                                                                                             | Original tables                         | Whole source SHA-256                                               | Excerpt SHA-256                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `alb-fy2016-original-separate-income-business.html` | [SEC original](https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/a1231201810-kdocument.htm) | 214 / 215 / 380                         | `6192df2c6bf80bd7ce1a3fa207a5a9768e7d30974b36496e413216cfcf7e6189` | `f719059c41d61f2dd1d48fb96507d85db8aebe49561d4f7a6da976fee68063fd` |
| `alb-fy2016-original-separate-xbrl.xml`             | [SEC original](https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/alb-20181231.xml)          | Original XML resources and declarations | `cfc362a9b6bbfe222887cc21700e02eff8db1e8a4910082a3958dfaa4e69d385` | `a74a4399dfef447fb5dd048a5ca3872a1267101d0f280eaa0dce5bf1b7d81780` |
| `ame-fy2016-original-separate-income-business.html` | [SEC original](https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/d640432d10k.htm)          | 107 / 118                               | `40208cf65d1e4e46789089db07452f9522ca4824b28b4d0e3b9c84582645d76e` | `4a7962578ad751b6f65aeb576678d0d79638e5073280553a9653aef51853af5e` |
