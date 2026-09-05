const FED_H10 = "https://www.federalreserve.gov/releases/h10/hist/dat00_ta.htm";

export type FxObservation = { date: string; rate: number };

export function parseH10TaiwanDollar(html: string): FxObservation[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const matches = text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+(?:\.\d+)?)/g);
  const slashDates = [...matches]
    .map((match) => {
      const [month, day, year] = match[1].split("/");
      return {
        date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
        rate: Number(match[2])
      };
    })
    .filter((item) => Number.isFinite(item.rate) && item.rate > 0);
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC"
  ];
  const namedDates = [...text.matchAll(/(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})\s+(\d+(?:\.\d+)?)/g)]
    .map((match) => {
      const shortYear = Number(match[3]);
      const year =
        match[3].length === 4 ? shortYear : shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
      const month = months.indexOf(match[2]) + 1;
      return {
        date: `${year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`,
        rate: Number(match[4])
      };
    })
    .filter((item) => Number.isFinite(item.rate) && item.rate > 0);
  return [
    ...new Map([...slashDates, ...namedDates].map((item) => [item.date, item])).values()
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function averageRate(observations: FxObservation[], start: string, end: string) {
  const inRange = observations.filter((item) => item.date >= start && item.date <= end);
  if (!inRange.length) throw new Error(`No Fed H.10 TWD/USD observations for ${start}–${end}.`);
  const dates = inRange.map((item) => Date.parse(item.date)).sort((a, b) => a - b);
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  if (
    inRange.length < Math.max(1, Math.floor(days * 0.5)) ||
    dates[0] - Date.parse(start) > 7 * 86_400_000 ||
    Date.parse(end) - dates.at(-1)! > 7 * 86_400_000
  )
    throw new Error(`Incomplete Fed H.10 observation coverage for ${start}–${end}.`);
  return inRange.reduce((sum, item) => sum + item.rate, 0) / inRange.length;
}

export async function fetchTaiwanDollarRates() {
  const response = await fetch(FED_H10, {
    headers: {
      "User-Agent": "ShengWanAcademicWebsite/0.1 https://github.com/Tocqueville0624/sheng-wan"
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Fed H.10 returned HTTP ${response.status}.`);
  const observations = parseH10TaiwanDollar(await response.text());
  if (!observations.length) throw new Error("Fed H.10 supplied no valid FX observations.");
  return { observations, sourceUrl: FED_H10 };
}
