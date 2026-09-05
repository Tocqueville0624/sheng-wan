import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { writeFile } from "node:fs/promises";

const indexable = process.env.PUBLIC_SITE_INDEXABLE === "true";
const siteUrl = process.env.PUBLIC_SITE_URL ?? "http://localhost:8787";
if (indexable && siteUrl !== "https://shengwan.org") {
  throw new Error("Indexable builds require PUBLIC_SITE_URL=https://shengwan.org");
}

export default defineConfig({
  integrations: [
    react(),
    {
      name: "deployment-headers",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await writeFile(
            new URL("_headers", dir),
            "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n" +
              (indexable ? "" : "  X-Robots-Tag: noindex, nofollow\n")
          );
          await writeFile(
            new URL("_redirects", dir),
            "/playground /playground/thales-olive/ 301\n/playground/ /playground/thales-olive/ 301\n"
          );
        }
      }
    }
  ],
  output: "static",
  site: siteUrl,
  build: {
    assets: "assets"
  },
  vite: {
    build: {
      cssMinify: "lightningcss"
    }
  }
});
