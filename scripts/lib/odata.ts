/**
 * Minimal client for the official Knesset OData v3 service.
 *
 *   https://knesset.gov.il/Odata/ParliamentInfo.svc/
 *
 * This is the ONLY sanctioned data source for Galui. Do not add HTML scrapers
 * for knesset.gov.il, and do not pull from oknesset.org or the
 * hasadna/knesset-data-pipelines mirrors — their data is years out of date.
 */

export const ODATA_BASE = "https://knesset.gov.il/Odata/ParliamentInfo.svc";

/**
 * The service silently caps every response at 100 rows, whatever `$top` says
 * (verified against KNS_Bill with `$top=500`). Paging is therefore mandatory
 * and the page size is not ours to choose.
 */
export const PAGE_SIZE = 100;

export interface QueryOptions {
  filter?: string;
  orderby?: string;
  select?: string;
  /** Stop after this many rows. Omit to drain the whole result set. */
  limit?: number;
  /** Rows to skip before the first returned row. */
  skip?: number;
}

interface ODataPage<T> {
  value: T[];
  "odata.count"?: string;
}

const USER_AGENT = "galui/0.1 (Knesset legislative tracker; OData client)";

function buildUrl(entity: string, opts: QueryOptions, skip: number, top: number) {
  const url = new URL(`${ODATA_BASE}/${entity}`);
  url.searchParams.set("$format", "json");
  url.searchParams.set("$top", String(top));
  if (skip > 0) url.searchParams.set("$skip", String(skip));
  if (opts.filter) url.searchParams.set("$filter", opts.filter);
  if (opts.orderby) url.searchParams.set("$orderby", opts.orderby);
  if (opts.select) url.searchParams.set("$select", opts.select);
  return url.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string, attempt = 0): Promise<ODataPage<T>> {
  const MAX_ATTEMPTS = 5;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as ODataPage<T>;
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS - 1) {
      throw new Error(`OData request failed after ${MAX_ATTEMPTS} attempts: ${url}\n  ${err}`);
    }
    // The service is slow and occasionally 500s under load; back off and retry.
    const backoff = 1000 * 2 ** attempt;
    console.warn(`  ! ${err instanceof Error ? err.message : err} — retrying in ${backoff}ms`);
    await sleep(backoff);
    return fetchJson<T>(url, attempt + 1);
  }
}

/** Fetch rows page by page, yielding each page as it arrives. */
export async function* pages<T>(
  entity: string,
  opts: QueryOptions = {},
): AsyncGenerator<T[], void, void> {
  let skip = opts.skip ?? 0;
  let yielded = 0;

  for (;;) {
    const remaining = opts.limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, opts.limit - yielded);
    if (remaining <= 0) return;

    const page = await fetchJson<T>(buildUrl(entity, opts, skip, remaining));
    const rows = page.value ?? [];
    if (rows.length === 0) return;

    yield rows;
    yielded += rows.length;
    skip += rows.length;

    if (opts.limit !== undefined && yielded >= opts.limit) return;
    // A short page means the result set is exhausted.
    if (rows.length < Math.min(PAGE_SIZE, remaining)) return;

    await sleep(150); // be a polite client
  }
}

/** Drain an entity into an array. */
export async function fetchAll<T>(entity: string, opts: QueryOptions = {}): Promise<T[]> {
  const out: T[] = [];
  for await (const page of pages<T>(entity, opts)) out.push(...page);
  return out;
}

/** Total row count for a filter, via `$inlinecount=allpages`. */
export async function count(entity: string, filter?: string): Promise<number> {
  const url = new URL(`${ODATA_BASE}/${entity}`);
  url.searchParams.set("$format", "json");
  url.searchParams.set("$top", "1");
  url.searchParams.set("$inlinecount", "allpages");
  if (filter) url.searchParams.set("$filter", filter);
  const page = await fetchJson<unknown>(url.toString());
  return Number(page["odata.count"] ?? 0);
}

/**
 * OData v3 serialises DateTime without a zone offset ("2026-01-28T14:54:00").
 * `new Date()` would read that as server-local time, so the same ETL run would
 * produce different instants on different machines. We pin it to UTC and the
 * UI formats in UTC, keeping the wall-clock time the Knesset published.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** OData booleans arrive as true/false/null. */
export function parseBool(value: boolean | null | undefined): boolean {
  return value === true;
}

/** Build an OData `X eq a or X eq b or ...` clause for a list of ids. */
export function orIn(field: string, ids: Array<number | string>): string {
  return ids.map((id) => `${field} eq ${id}`).join(" or ");
}

/** OData filters have a length limit; chunk id lists before building clauses. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
