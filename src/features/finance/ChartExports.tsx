import { useState, type RefObject } from "react";

export function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Keep the object alive long enough for browsers to begin the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgSource(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const width = svg.viewBox.baseVal.width;
  const requestedHeight = Number(svg.dataset.exportHeight);
  const height =
    Number.isFinite(requestedHeight) && requestedHeight > svg.viewBox.baseVal.height
      ? requestedHeight
      : svg.viewBox.baseVal.height;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  copy.setAttribute("viewBox", `0 0 ${width} ${height}`);
  copy.removeAttribute("class");
  // Screen disclosures stay compact; standalone downloads retain their source register.
  copy.querySelector("[data-chart-paper]")?.setAttribute("height", String(height));
  for (const element of copy.querySelectorAll<SVGElement>("[data-export-only]")) {
    element.style.removeProperty("display");
    element.removeAttribute("aria-hidden");
  }
  await Promise.all(
    [...copy.querySelectorAll("image")].map(async (image) => {
      const href = image.getAttribute("href");
      if (!href || href.startsWith("data:")) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith("/media/company-logos/"))
        throw new Error("Unsupported export asset.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Logo unavailable for export.");
      const blob = await response.blob();
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Logo encoding failed."));
        reader.readAsDataURL(blob);
      });
      image.setAttribute("href", encoded);
    })
  );
  return { source: new XMLSerializer().serializeToString(copy), width, height };
}

export function ChartExports({
  svgRef,
  filename,
  label
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  filename: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exportChart = async (format: "svg" | "png") => {
    const svg = svgRef.current;
    if (!svg) return;
    setError("");
    setBusy(true);
    try {
      const { source, width, height } = await svgSource(svg);
      if (format === "svg") {
        downloadFile(
          `${filename}.svg`,
          new Blob([source], { type: "image/svg+xml;charset=utf-8" })
        );
      } else {
        const url = URL.createObjectURL(
          new Blob([source], { type: "image/svg+xml;charset=utf-8" })
        );
        try {
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("The chart could not be rasterized."));
            image.src = url;
          });
          const canvas = document.createElement("canvas");
          canvas.width = width * 3;
          canvas.height = height * 3;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable.");
          context.scale(3, 3);
          context.drawImage(image, 0, 0, width, height);
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (result) => (result ? resolve(result) : reject(new Error("PNG encoding failed."))),
              "image/png"
            );
          });
          downloadFile(`${filename}.png`, blob);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      setError("Download failed. Please try SVG, or try again in a supported browser.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chart-export-control">
      <div className="export-group" role="group" aria-label={`Download ${label}`}>
        <span>Download:</span>
        <button type="button" disabled={busy} onClick={() => void exportChart("svg")}>
          SVG
        </button>
        <button type="button" disabled={busy} onClick={() => void exportChart("png")}>
          PNG
        </button>
      </div>
      {error && (
        <p className="export-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const chartColors = {
  paper: "#fffdf8",
  ink: "#18394b",
  muted: "#536775",
  grid: "#dce4e5",
  revenue: "#337d9f",
  profit: "#287758",
  expense: "#b95045",
  revenueRibbon: "#a6cfdf",
  profitRibbon: "#afd0b8",
  expenseRibbon: "#e8b1a8"
};

export const chartFont = "Arial, Helvetica, sans-serif";
