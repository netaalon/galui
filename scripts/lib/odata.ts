/**
 * Minimal client for the official Knesset OData v4 service.
 *
 *   https://knesset.gov.il/OdataV4/ParliamentInfo/
 *
 * This is the ONLY sanctioned data source for Galui. Do not add HTML scrapers
 * for knesset.gov.il, and do not pull from oknesset.org or the
 * hasadna/knesset-data-pipelines mirrors — their data is years out of date.
 *
 * We read v4 rather than the older `/Odata/ParliamentInfo.svc` (v2/v3) because
 * the Knesset's own developer manual says v2 is on the way out ("מעתה מומלץ
 * למשתמשים להשתמש בפיד החדש. הכנסת מתעתדת להפסיק לפרסם את המידע בפורמט של
 * ODATA-v2"), and because v4 publishes ten entity sets v2 never did — votes,
 * lobbyists and secondary legislation among them. See the `knesset-odata`
 * skill for the differences that bite.
 */

export const ODATA_BASE = "https://knesset.gov.il/OdataV4/ParliamentInfo";

/**
 * The deprecated v2 service. Nothing should read from it — with one measured
 * exception, `KNS_MkSiteCode`, whose v4 rows carry broken person ids. See
 * `ingestPeople()`. Do not add a second.
 */
export const ODATA_V2_BASE = "https://knesset.gov.il/Odata/ParliamentInfo.svc";

/**
 * The service silently caps every response at 100 rows, whatever `$top` says
 * (verified against KNS_Bill with `$top=500`: 100 rows plus an `@odata.nextLink`
 * offering the rest). Paging is mandatory and the page size is not ours to
 * choose. This did not change between v2 and v4.
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
  /** Service root, for the one entity still read from v2. Defaults to `ODATA_BASE`. */
  base?: string;
}

interface ODataPage<T> {
  value: T[];
  /** Present only when the request asked for `$count=true`. */
  "@odata.count"?: number;
}

const USER_AGENT = "galui/0.1 (Knesset legislative tracker; OData client)";

function buildUrl(entity: string, opts: QueryOptions, skip: number, top: number) {
  const url = new URL(`${opts.base ?? ODATA_BASE}/${entity}`);
  // v2 needs to be told to answer in JSON; v4 does it by default.
  if (opts.base === ODATA_V2_BASE) url.searchParams.set("$format", "json");
  url.searchParams.set("$top", String(top));
  if (skip > 0) url.searchParams.set("$skip", String(skip));
  if (opts.filter) url.searchParams.set("$filter", opts.filter);
  if (opts.orderby) url.searchParams.set("$orderby", opts.orderby);
  if (opts.select) url.searchParams.set("$select", opts.select);
  return url.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 4xx we asked for: the same request will fail the same way forever. */
class BadRequest extends Error {}

async function fetchJson<T>(url: string, attempt = 0): Promise<ODataPage<T>> {
  const MAX_ATTEMPTS = 5;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      // Retrying a malformed query just delays the error by a minute and buries
      // its cause under four backoffs, so fail fast on anything deterministic.
      // The service explains itself in the body — a filter naming a property
      // that does not exist says so precisely — and that text is worth far more
      // than the status line. 408 and 429 are about timing, so they still retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        const body = await res.text().catch(() => "");
        const detail = body.slice(0, 300).replace(/\s+/g, " ").trim();
        throw new BadRequest(`HTTP ${res.status} ${res.statusText} for ${url}${detail ? `\n  ${detail}` : ""}`);
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    // KNS_DocumentQuery answers outside the OData envelope — see the note on
    // that entity in scripts/fetch-odata.ts — returning a bare array of rows.
    return (Array.isArray(json) ? { value: json as T[] } : json) as ODataPage<T>;
  } catch (err) {
    if (err instanceof BadRequest) throw err;
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

    await sleep(50); // concurrency is bounded by mapLimit; keep a light touch
  }
}

/** Drain an entity into an array. */
export async function fetchAll<T>(entity: string, opts: QueryOptions = {}): Promise<T[]> {
  const out: T[] = [];
  for await (const page of pages<T>(entity, opts)) out.push(...page);
  return out;
}

/** Total row count for a filter. v4 spells this `$count`; v2 spelled it `$inlinecount`. */
export async function count(entity: string, filter?: string): Promise<number> {
  const url = new URL(`${ODATA_BASE}/${entity}`);
  url.searchParams.set("$top", "1");
  url.searchParams.set("$count", "true");
  if (filter) url.searchParams.set("$filter", filter);
  const page = await fetchJson<unknown>(url.toString());
  return Number(page["@odata.count"] ?? 0);
}

/**
 * Every date in this database is an Israeli wall-clock reading stored as if it
 * were UTC, and the UI formats in UTC — so a sitting the Knesset published as
 * 10:00 is stored as 10:00Z and displayed as 10:00.
 *
 * That convention predates v4 and survives it deliberately. v2 served naive
 * timestamps ("2026-01-28T14:54:00") which we simply pinned to UTC. v4 serves
 * the same wall clock with Israel's offset attached ("...+03:00"), so honouring
 * the offset would shift every stored time by two or three hours: sittings
 * would display at 07:00, and the month buckets behind the activity charts —
 * grouped with `strftime` over the stored value — would put a late-evening
 * sitting in the wrong day. Dropping the offset keeps the published wall clock,
 * which is what the site is about, and keeps v4 rows byte-identical to the v2
 * rows they replace.
 *
 * This is safe only because the feed's offsets are always Israel's own: 3,181
 * date values sampled across six entities and three points in each were +02:00
 * or +03:00 and nothing else. If a row ever arrives in another zone, its wall
 * clock is not the one the Knesset meant, and this would need to convert.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const local = value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "");
  const d = new Date(`${local}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** OData booleans arrive as true/false/null. */
export function parseBool(value: boolean | null | undefined): boolean {
  return value === true;
}

/**
 * Build an OData `X in (a,b,c)` clause for a list of ids.
 *
 * v2 had no `in` operator, so this used to emit `X eq a or X eq b or ...`.
 * v4 rejects that beyond about 25 ids — not on length, but with "The node
 * count limit of '100' has been exceeded", counting every node of the parsed
 * filter expression. `in` is one node whatever the list length, so it sidesteps
 * the ceiling entirely and is four times terser per id, which is why batches
 * here are ~180 ids where v2 managed ~48.
 */
export function inList(field: string, ids: Array<number | string>): string {
  return `${field} in (${ids.join(",")})`;
}

/** Split a list into fixed-size groups. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The service still rejects long request URLs with a bare 404. Bisected against
 * `KNS_DocumentCommitteeSession` the ceiling is a whole URL of ~2,100 encoded
 * characters: 200 ids succeeded at 2,129 and 201 failed at 2,149. Budget well
 * under that, since the entity name and the other query parameters vary.
 */
const URL_BUDGET = 1600;

export function chunkForFilter(ids: Array<number | string>, field: string, extra = 0): Array<Array<number | string>> {
  const perId = encodeURIComponent("000000000,").length;
  const fixed = encodeURIComponent(`${field} in ()`).length + extra;
  const size = Math.max(1, Math.floor((URL_BUDGET - fixed) / perId));
  return chunk(ids, size);
}

/**
 * Run tasks with bounded concurrency. The service handles a handful of parallel
 * requests comfortably (6 at once measured ~4x faster than serial with no
 * errors); this keeps that speedup without hammering a government endpoint.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
      done++;
      onProgress?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Default parallelism for by-parent fetches. */
export const CONCURRENCY = 5;

/**
 * Fetch every row of `entity` whose `field` matches one of `ids`, batching the
 * ids into as few requests as the URL budget allows and running those in
 * parallel. This is the workhorse for the child tables, none of which carry a
 * KnessetNum to filter on directly.
 */
export async function fetchByIds<T>(
  entity: string,
  /**
   * The property on `entity` to match, which must exist there. Child tables
   * keep the legacy foreign key names (`KNS_BillInitiator.BillID`), but a
   * parent table fetched by its own key wants `"Id"` — v4 renamed every primary
   * key, and `KNS_CommitteeSession.CommitteeSessionID` is now a 400.
   */
  field: string,
  ids: Array<number | string>,
  opts: { prefix?: string; label?: string } = {},
): Promise<T[]> {
  if (ids.length === 0) return [];
  const prefix = opts.prefix ? `${opts.prefix} and ` : "";
  const batches = chunkForFilter(ids, field, encodeURIComponent(prefix).length);
  const out: T[] = [];

  await mapLimit(
    batches,
    CONCURRENCY,
    async (batch) => {
      const rows = await fetchAll<T>(entity, { filter: `${prefix}${inList(field, batch)}` });
      out.push(...rows);
    },
    (done, total) => {
      if (opts.label) process.stdout.write(`\r  … ${opts.label} ${done}/${total} batches, ${out.length} rows`);
    },
  );
  if (opts.label) process.stdout.write("\r".padEnd(70) + "\r");
  return out;
}
