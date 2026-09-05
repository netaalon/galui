/**
 * Pull MK headshots from Wikimedia Commons.
 *
 *   npx tsx scripts/fetch-photos.ts                 # fill in missing photos (id join)
 *   npx tsx scripts/fetch-photos.ts --refresh       # re-check everyone
 *   npx tsx scripts/fetch-photos.ts --dry-run
 *
 * For members the id join cannot reach, a second, weaker pass matches on name
 * and requires a human to check the faces before anything is stored:
 *   npx tsx scripts/fetch-photos.ts --propose       # photo-review.json + public/photo-review.html
 *   npx tsx scripts/fetch-photos.ts --apply-review  # writes only approve:true entries
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
import { readFileSync, writeFileSync } from "node:fs";
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
const PROPOSE = process.argv.includes("--propose");
const APPLY_REVIEW = process.argv.includes("--apply-review");

const REVIEW_JSON = "photo-review.json";
// Written into public/ so the running dev server serves it — the reviewer
// may not share a filesystem with whatever produced it.
const REVIEW_HTML = "public/photo-review.html";

/** Wikidata: the position "Knesset member". */
const Q_KNESSET_MEMBER = "Q4047513";

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


// ---------------------------------------------------------------------------
// Name-match fallback (proposal only — never writes directly)
// ---------------------------------------------------------------------------

interface Candidate {
  approve: boolean;
  personId: number;
  ourName: string;
  faction: string | null;
  wikidataLabel: string;
  qid: string;
  imageUrl: string | null;
  /** Wikidata's party for this item — a second signal, independent of the name. */
  wikidataParty: string | null;
  /** True when that party plausibly corresponds to our faction. */
  partyAgrees: boolean;
  license: string | null;
  credit: string | null;
  commonsPage: string | null;
  memberPage: string;
}

/**
 * Some members have a Wikidata item carrying a photo but no P9770, so the id
 * join misses them. Matching on name instead can recover those — but a wrong
 * name match does not fail visibly, it puts a real person's face on the wrong
 * MK. So this pass only ever *proposes*: it writes a review file and an HTML
 * contact sheet, and nothing reaches the database until a human approves it.
 *
 * The gate is deliberately strict: the Wikidata label must equal our name once
 * normalised, the item must hold the position "Knesset member" (Q4047513), and
 * the name must resolve to exactly one such item. Ambiguity is rejected, not
 * guessed.
 */
async function proposeByName() {
  const people = await prisma.person.findMany({
    where: { isMk: true, imageUrl: null },
    select: { personId: true, firstName: true, lastName: true, factionName: true },
  });
  console.log(`${people.length} members still without a photo`);
  if (people.length === 0) return;

  const values = people.map((p) => `"${normalise(`${p.firstName} ${p.lastName}`)}"@he`).join(" ");
  const sparql = `
    SELECT ?name ?person ?image (SAMPLE(?partyLabel) AS ?party) WHERE {
      VALUES ?name { ${values} }
      ?person rdfs:label ?name .
      ?person wdt:P39 wd:${Q_KNESSET_MEMBER} .
      OPTIONAL { ?person wdt:P18 ?image . }
      OPTIONAL { ?person wdt:P102 ?partyItem . ?partyItem rdfs:label ?partyLabel . FILTER(lang(?partyLabel) = "he") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "he,en". }
    } GROUP BY ?name ?person ?image`;
  console.log("Querying Wikidata by name, gated on the Knesset-member position…");
  const data = await getJson<{
    results: {
      bindings: Array<{ name: { value: string }; person: { value: string }; image?: { value: string }; party?: { value: string } }>;
    };
  }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`);

  // Reject any name that resolves to more than one Knesset member.
  const byName = new Map<string, Array<{ qid: string; image?: string; party?: string }>>();
  for (const r of data.results.bindings) {
    const qid = r.person.value.split("/").pop() ?? "";
    byName.set(r.name.value, [...(byName.get(r.name.value) ?? []), { qid, image: r.image?.value, party: r.party?.value }]);
  }

  const titles: string[] = [];
  const staged: Array<{ person: (typeof people)[number]; qid: string; title: string; party?: string }> = [];
  let ambiguous = 0, noItem = 0, noPhoto = 0;

  for (const p of people) {
    const key = normalise(`${p.firstName} ${p.lastName}`);
    const hits = byName.get(key);
    if (!hits || hits.length === 0) { noItem++; continue; }
    if (hits.length > 1) { ambiguous++; console.warn(`  ! ambiguous, skipped: ${key} -> ${hits.map((h) => h.qid).join(", ")}`); continue; }
    const hit = hits[0];
    if (!hit.image) { noPhoto++; continue; }
    const title = decodeURIComponent(hit.image.split("/").pop() ?? "").replace(/_/g, " ");
    titles.push(title);
    staged.push({ person: p, qid: hit.qid, title, party: hit.party });
  }
  console.log(`  ${staged.length} candidates · ${noItem} no item · ${noPhoto} item without a photo · ${ambiguous} ambiguous`);
  if (staged.length === 0) return;

  console.log("\nFetching file info from Commons…");
  const info = await fetchCommonsInfo([...new Set(titles)]);

  const candidates: Candidate[] = [];
  for (const { person, qid, title, party } of staged) {
    const meta = info.get(title);
    const licence = meta?.extmetadata?.LicenseShortName?.value ? strip(meta.extmetadata.LicenseShortName.value) : null;
    if (!meta?.thumburl || !licence || !ALLOWED_LICENCE.test(licence)) continue;
    candidates.push({
      approve: false,
      personId: person.personId,
      ourName: `${person.firstName} ${person.lastName}`,
      faction: person.factionName?.trim() ?? null,
      wikidataLabel: normalise(`${person.firstName} ${person.lastName}`),
      qid,
      wikidataParty: party ?? null,
      partyAgrees: partiesAgree(person.factionName, party),
      imageUrl: cleanUrl(meta.thumburl),
      license: licence,
      credit: meta.extmetadata?.Attribution?.value
        ? strip(meta.extmetadata.Attribution.value)
        : meta.extmetadata?.Artist?.value
          ? strip(meta.extmetadata.Artist.value)
          : null,
      commonsPage: meta.descriptionurl ? cleanUrl(meta.descriptionurl) : null,
      memberPage: `/members/${person.personId}`,
    });
  }

  writeFileSync(REVIEW_JSON, JSON.stringify(candidates, null, 2), "utf8");
  writeFileSync(REVIEW_HTML, renderReview(candidates), "utf8");
  console.log(`\n${candidates.length} candidates written to ${REVIEW_JSON}`);
  console.log(`Open http://localhost:3000/photo-review.html and check every face against the name.`);
  console.log(`Then set "approve": true on the ones that are right and run:`);
  console.log(`  npx tsx scripts/fetch-photos.ts --apply-review`);
}

/**
 * Faction names differ between the Knesset and Wikidata ("הליכוד" vs "ליכוד",
 * ש"ס's full ceremonial name vs its common one), so compare on a shared word
 * rather than equality. This only flags for the reviewer; it never gates.
 */
function partiesAgree(faction: string | null | undefined, party: string | null | undefined): boolean {
  if (!faction || !party) return false;
  const words = (s: string) => new Set(normalise(s).replace(/[״"׳']/g, "").split(" ").filter((w) => w.length > 2));
  const a = words(faction);
  return [...words(party)].some((w) => a.has(w));
}

/** A contact sheet, because names in a JSON file cannot be checked against faces. */
function renderReview(candidates: Candidate[]): string {
  const cards = candidates
    .map(
      (c) => `
    <figure>
      <img src="${c.imageUrl}" alt="" loading="lazy">
      <figcaption>
        <strong>${c.ourName}</strong>
        <span>${c.faction ?? ""}</span>
        <span class="${c.partyAgrees ? "ok" : "warn"}">${
          c.partyAgrees ? "✓ מפלגה תואמת" : `⚠ מפלגה בוויקינתונים: ${c.wikidataParty ?? "לא ידועה"}`
        }</span>
        <span class="meta">${c.license ?? ""}${c.credit ? ` · ${c.credit}` : ""}</span>
        <span class="meta">
          <a href="https://www.wikidata.org/wiki/${c.qid}" target="_blank" rel="noreferrer">${c.qid}</a>
          ${c.commonsPage ? `· <a href="${c.commonsPage}" target="_blank" rel="noreferrer">Commons</a>` : ""}
        </span>
      </figcaption>
    </figure>`,
    )
    .join("");

  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>Galui — photo review</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;background:#fafafa;color:#111}
 h1{font-size:1.25rem} p{color:#555;max-width:52rem;line-height:1.6}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:1.25rem;margin-top:1.5rem}
 figure{margin:0;background:#fff;border:1px solid #e3e3e3;border-radius:10px;overflow:hidden}
 img{width:100%;height:210px;object-fit:cover;object-position:top;display:block;background:#eee}
 figcaption{padding:.6rem .7rem;display:flex;flex-direction:column;gap:.15rem;font-size:.82rem}
 .meta{color:#666;font-size:.72rem}
 .ok{color:#15803d;font-size:.72rem}
 .warn{color:#b45309;font-size:.72rem}
 a{color:#2563eb}
</style>
<h1>בדיקת תצלומים — ${candidates.length} מועמדים</h1>
<p>כל תצלום כאן הותאם <strong>לפי שם</strong>, לא לפי מזהה — ולכן הוא עלול להיות של אדם אחר.
בדקו שכל פנים מתאימות לשם שמתחתן, ואז סמנו <code>"approve": true</code> ב־<code>${REVIEW_JSON}</code>
עבור אלה שנכונים בלבד. מה שלא סומן לא ייכתב.</p>
<p><strong>${candidates.filter((c) => !c.partyAgrees).length}</strong> מהמועמדים מסומנים באזהרה —
המפלגה בוויקינתונים אינה תואמת את הסיעה שלנו. בדקו אותם בקפידה יתרה.</p>
<div class="grid">${cards}</div>
</html>`;
}

async function applyReview() {
  let candidates: Candidate[];
  try {
    candidates = JSON.parse(readFileSync(REVIEW_JSON, "utf8"));
  } catch {
    console.error(`Could not read ${REVIEW_JSON}. Run with --propose first.`);
    process.exitCode = 1;
    return;
  }

  const approved = candidates.filter((c) => c.approve === true);
  console.log(`${candidates.length} candidates, ${approved.length} approved`);
  if (approved.length === 0) {
    console.log(`Nothing to write. Set "approve": true on the entries you have verified.`);
    return;
  }

  for (const c of approved) {
    if (!c.imageUrl) continue;
    if (DRY_RUN) { console.log(`  would write ${c.ourName}`); continue; }
    await prisma.person.update({
      where: { personId: c.personId },
      data: {
        imageUrl: c.imageUrl,
        imageCredit: c.credit,
        imageLicense: c.license,
        imageSourceUrl: c.commonsPage,
      },
    });
  }
  console.log(`${DRY_RUN ? "Would write" : "Wrote"} ${approved.length} approved photos.`);
  const serving = await prisma.person.count({ where: { isMk: true, mkEndDate: null } });
  const servingWith = await prisma.person.count({ where: { isMk: true, mkEndDate: null, imageUrl: { not: null } } });
  console.log(`coverage: ${servingWith}/${serving} serving`);
}

async function main() {
  console.log(`Galui photo fetch — Wikimedia Commons${DRY_RUN ? " (dry run)" : ""}`);

  if (APPLY_REVIEW) return applyReview();
  if (PROPOSE) return proposeByName();

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
