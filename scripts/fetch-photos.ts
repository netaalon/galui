/**
 * Pull MK headshots from Wikimedia Commons.
 *
 *   npx tsx scripts/fetch-photos.ts            # fill in missing photos
 *   npx tsx scripts/fetch-photos.ts --refresh  # re-check everyone
 *   npx tsx scripts/fetch-photos.ts --dry-run
 *
 * Deliberately separate from fetch-odata.ts. The Knesset OData service exposes
 * no image of any kind, and its own archive is only reachable through a
 * bot-protected host whose files carry no stated licence. The Knesset Archives
 * did, however, donate a large batch of MK portraits to Wikimedia Commons under
 * CC BY-SA, credited to the photographer — so Commons is the licensed route to
 * the same pictures.
 *
 * The join runs through Wikidata property P9770 ("Knesset member ID"), which is
 * KNS_MkSiteCode.SiteId — NOT MKSiteCode. The two are different id spaces over
 * overlapping small integers, so getting it wrong attaches a real photo of the
 * wrong person: SiteId 837 is חמד עמאר, while MKSiteCode 837 is חנין זועבי.
 * Because that failure is silent, every match is name-checked before it is
 * written, and disagreements are skipped and reported.
 */

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { chunk } from "./lib/odata.js";

const UA = "galui/0.1 (Knesset legislative tracker; https://github.com/netaalon/galui)";
const THUMB_WIDTH = 400;

/**
 * Licences we are willing to display. Anything else is skipped.
 * Note CC0 needs its own alternative: it is followed by a digit, not the
 * separator the other Creative Commons names use.
 */
const ALLOWED_LICENCE = /^(cc0|cc[- ]|public domain|pd-|no restrictions)/i;

const REFRESH = process.argv.includes("--refresh");
const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(2000 * 2 ** attempt);
    return getJson<T>(url, attempt + 1);
  }
}

/** Wikidata: Knesset SiteId -> Commons file title + the item's label. */
async function fetchWikidataPhotos(): Promise<Map<string, { title: string; label: string }>> {
  const sparql = `
    SELECT ?knessetId ?personLabel ?image WHERE {
      ?person wdt:P9770 ?knessetId .
      ?person wdt:P18 ?image .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "he,en". }
    }`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const data = await getJson<{
    results: { bindings: Array<{ knessetId: { value: string }; personLabel: { value: string }; image: { value: string } }> };
  }>(url);

  const out = new Map<string, { title: string; label: string }>();
  for (const r of data.results.bindings) {
    // P18 is a Special:FilePath URL; the file title is its last segment.
    const title = decodeURIComponent(r.image.value.split("/").pop() ?? "").replace(/_/g, " ");
    if (title) out.set(r.knessetId.value, { title, label: r.personLabel.value });
  }
  return out;
}

interface CommonsInfo {
  thumburl?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value: string }>;
}

/** Commons: thumbnail URL plus the licence and credit we are obliged to show. */
async function fetchCommonsInfo(titles: string[]): Promise<Map<string, CommonsInfo>> {
  const out = new Map<string, CommonsInfo>();
  // The API accepts up to 50 titles per call.
  for (const batch of chunk(titles, 50)) {
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
      `&iiprop=url|extmetadata&iiurlwidth=${THUMB_WIDTH}&titles=` +
      encodeURIComponent(batch.map((t) => `File:${t}`).join("|"));
    const data = await getJson<{ query?: { pages?: Record<string, { title?: string; imageinfo?: CommonsInfo[] }> } }>(url);
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (page.title && page.imageinfo?.[0]) {
        out.set(page.title.replace(/^File:/, ""), page.imageinfo[0]);
      }
    }
    process.stdout.write(`\r  … ${out.size}/${titles.length} files`);
    await sleep(200);
  }
  if (titles.length) process.stdout.write("\r".padEnd(40) + "\r");
  return out;
}

const strip = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();

/** The API appends utm_* analytics parameters; they are not part of the file. */
function cleanUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  return u.toString().replace(/\?$/, "");
}
const normalise = (s: string) => s.replace(/[־-]/g, " ").replace(/\s+/g, " ").trim();

/** Do our name and Wikidata's plausibly refer to the same person? */
function namesAgree(ours: string, theirs: string): boolean {
  const a = normalise(ours);
  const b = normalise(theirs);
  if (a === b) return true;
  const aWords = new Set(a.split(" ").filter((w) => w.length > 2));
  const bWords = b.split(" ").filter((w) => w.length > 2);
  // At least one substantial name part in common, in either direction.
  return bWords.some((w) => aWords.has(w));
}

async function main() {
  console.log(`Galui photo fetch — Wikimedia Commons${DRY_RUN ? " (dry run)" : ""}`);

  const people = await prisma.person.findMany({
    where: { isMk: true, siteId: { not: null }, ...(REFRESH ? {} : { imageUrl: null }) },
    select: { personId: true, firstName: true, lastName: true, siteId: true },
  });
  console.log(`${people.length} members to look up${REFRESH ? "" : " (missing photos only)"}`);
  if (people.length === 0) return;

  console.log("\nQuerying Wikidata (P9770 → P18)…");
  const wikidata = await fetchWikidataPhotos();
  console.log(`  ${wikidata.size} Knesset ids carry an image`);

  const candidates = people
    .map((p) => ({ person: p, hit: wikidata.get(String(p.siteId)) }))
    .filter((c): c is { person: (typeof people)[number]; hit: { title: string; label: string } } => c.hit != null);
  console.log(`  ${candidates.length} of our members matched`);

  // Guard the id-space confusion described at the top of this file.
  const agreed = candidates.filter((c) => namesAgree(`${c.person.firstName} ${c.person.lastName}`, c.hit.label));
  const rejected = candidates.filter((c) => !agreed.includes(c));
  if (rejected.length) {
    console.warn(`\n  ! ${rejected.length} rejected on a name mismatch (not written):`);
    for (const r of rejected) console.warn(`      ${r.person.firstName} ${r.person.lastName}  !=  ${r.hit.label}`);
  }

  console.log("\nFetching file info from Commons…");
  const info = await fetchCommonsInfo([...new Set(agreed.map((c) => c.hit.title))]);

  let written = 0;
  const skipped: string[] = [];
  for (const { person, hit } of agreed) {
    const meta = info.get(hit.title);
    const thumb = meta?.thumburl;
    const licence = meta?.extmetadata?.LicenseShortName?.value
      ? strip(meta.extmetadata.LicenseShortName.value)
      : null;

    if (!thumb || !licence) { skipped.push(`${hit.title} (no thumbnail or licence)`); continue; }
    if (!ALLOWED_LICENCE.test(licence)) { skipped.push(`${hit.title} (licence: ${licence})`); continue; }

    const artist = meta?.extmetadata?.Artist?.value ? strip(meta.extmetadata.Artist.value) : null;
    const attribution = meta?.extmetadata?.Attribution?.value ? strip(meta.extmetadata.Attribution.value) : null;

    if (!DRY_RUN) {
      await prisma.person.update({
        where: { personId: person.personId },
        data: {
          imageUrl: cleanUrl(thumb),
          imageCredit: attribution ?? artist,
          imageLicense: licence,
          imageSourceUrl: meta?.descriptionurl ? cleanUrl(meta.descriptionurl) : null,
        },
      });
    }
    written++;
  }

  if (skipped.length) {
    console.log(`\n  ${skipped.length} skipped:`);
    for (const s of skipped.slice(0, 10)) console.log(`    ${s}`);
  }

  const licences = await prisma.person.groupBy({ by: ["imageLicense"], where: { imageLicense: { not: null } }, _count: true });
  console.log(`\n${DRY_RUN ? "Would write" : "Wrote"} ${written} photos.`);
  if (!DRY_RUN) {
    console.log("licences in the database:");
    for (const l of licences) console.log(`  ${String(l.imageLicense).padEnd(22)} ${l._count}`);
    const withPhoto = await prisma.person.count({ where: { isMk: true, imageUrl: { not: null } } });
    const serving = await prisma.person.count({ where: { isMk: true, mkEndDate: null } });
    const servingWith = await prisma.person.count({ where: { isMk: true, mkEndDate: null, imageUrl: { not: null } } });
    console.log(`coverage: ${withPhoto} of all MKs · ${servingWith}/${serving} serving`);
  }
}

main()
  .catch((err) => { console.error("\nPhoto fetch failed:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
