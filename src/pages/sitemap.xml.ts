import type { APIRoute } from "astro";

const routes = [
  "/",
  "/cv",
  "/research",
  "/teaching",
  "/playground/thales-olive",
  "/playground/hugo-le-chatssius",
  "/playground/photo-gallery"
];
export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${new URL(route, site)}</loc></url>`).join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
