import type { APIRoute, GetStaticPaths } from "astro";
import manifest from "../../../../data/generated/finance-reviewed-snapshots.json";

const companies = import.meta.glob("../../../../data/generated/finance-reviewed/*.json", {
  eager: true,
  import: "default"
});

export const getStaticPaths: GetStaticPaths = () =>
  manifest.map((entry) => ({
    params: { cik: entry.cik },
    props: { company: companies[`../../../../data/generated/finance-reviewed/${entry.cik}.json`] }
  }));

export const GET: APIRoute = ({ props }) => {
  if (!props.company) throw new Error("Reviewed financial snapshot is missing.");
  return new Response(JSON.stringify(props.company), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
};
