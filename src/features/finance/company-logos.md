# Company logo provenance

These locally embedded assets identify the companies discussed in the financial charts. The marks remain the property of their respective owners; inclusion does not imply sponsorship, affiliation, or endorsement. They are third-party trademarks, not original artwork or freely licensed project assets. No AI-generated or traced marks are used.

Captured and checked against official public company pages on 2026-09-02. `company-logos.json` records each original asset URL, page URL, dimensions, and SHA-256 digest of the embedded payload. SVG and PNG downloads contain these image data URIs directly, so viewing an export does not fetch logos from the Internet.

| Ticker | Official source                                                                                    | Local treatment                                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AAPL   | [Apple homepage](https://www.apple.com/) global navigation                                         | Exact official Apple SVG path. Only the surrounding navigation whitespace is removed from the viewBox; the path is unchanged and uses black. |
| MSFT   | [Microsoft homepage](https://www.microsoft.com/), `uhf.microsoft.com/images/microsoft/RE1Mu3b.png` | Original 216 × 46 PNG, uniformly scaled.                                                                                                     |
| GOOGL  | [Alphabet investor relations](https://abc.xyz/), official Q4-hosted `alphabet_logo.png`            | Original 800 × 188 PNG with the official Alphabet Investor Relations lockup, not Google’s logo.                                              |
| AMZN   | [Amazon company newsroom](https://www.aboutamazon.com/), footer `icon-LogoLightV2`                 | Exact inline white/orange SVG, displayed on a dark backing to preserve its original colors.                                                  |
| META   | [Meta company website](https://about.meta.com/), structured-data logo asset                        | Original SVG with its embedded official gradient definitions.                                                                                |
| NVDA   | [NVIDIA homepage](https://www.nvidia.com/en-us/), structured-data logo asset                       | Original SVG with green symbol and black wordmark, unchanged.                                                                                |
| TSM    | [TSMC homepage](https://www.tsmc.com/english), header `logo.png`                                   | Original 132 × 100 PNG downloaded through the normally loaded official page; displayed at 50 chart units high, not AI-upscaled.              |

All marks preserve aspect ratio and have a reserved header slot, separate from company/period titles and source-status text. The chart remains labeled in ordinary text; decorative logos are hidden from the accessibility tree to avoid repeating the company name.

Official brand guidance remains applicable, including [Meta’s brand resources](https://www.meta.com/brand/resources/meta/company-brand/) and [Microsoft’s trademark resources](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). This provenance record is not a trademark license or a claim that permission has been granted. Local implementation does not publish or deploy the website.
