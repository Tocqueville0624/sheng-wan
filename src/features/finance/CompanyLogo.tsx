import logos from "./company-logo-manifest.json" with { type: "json" };

type LogoTicker = keyof typeof logos;

/** Load only this company's pinned artwork; exports inline it before serialization. */
export function CompanyLogo({ ticker, x }: { ticker: string; x: number }) {
  const logo = logos[(ticker === "GOOG" ? "GOOGL" : ticker) as LogoTicker];
  if (!logo) return null;
  const scale = Math.min(150 / logo.width, (ticker === "TSM" ? 50 : 42) / logo.height);
  const width = logo.width * scale;
  const height = logo.height * scale;
  return (
    <g aria-hidden="true">
      {ticker === "AMZN" && <rect x={x} y={14} width={180} height={72} fill="#161e2d" />}
      <image
        data-company-logo={ticker}
        href={logo.path}
        x={x + (180 - width) / 2}
        y={29 + (42 - height) / 2}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid meet"
      />
    </g>
  );
}
