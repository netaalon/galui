/**
 * Load committee attendance parsed from protocols into the database.
 *
 *   python3 scripts/protocols/extract_attendance.py   # writes data/attendance.jsonl
 *   npx tsx scripts/load-attendance.ts                # loads it
 *   npx tsx scripts/load-attendance.ts --dry-run
 *
 * Only committee members and visiting MKs are persisted, and only when the name
 * resolves to exactly one Person. Both groups are by definition in the Person
 * registry, so requiring a match is not a convenience — it is what keeps job
 * titles out of the roster. Protocol sections are not perfectly regular (a
 * title occasionally appears with no dash before it, and "נוכחים:" introduces
 * officials), and without this rule those lines arrive looking like names.
 *
 * Invitees, legal advisors and committee managers are parsed but deliberately
 * not stored yet: they are mostly people outside the registry, so there is
 * nothing to validate them against and the noise would be invisible.
 */

import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.js";

const JSONL = "data/attendance.jsonl";
const DRY_RUN = process.argv.includes("--dry-run");
const EXTRACTED_BY = "protocol-header/v1";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" }),
});

interface Entry { name: string; title: string | null }
interface Record_ {
  documentId: string;
  committeeSessionId: number;
  chair: string | null;
  sections: { members: Entry[]; mks: Entry[] } & Record<string, Entry[]>;
}

const normalise = (s: string) =>
  s.replace(/[־\-]/g, " ").replace(/[׳'"״]/g, "").replace(/\s+/g, " ").trim();

/**
 * A looser key for Hebrew spelling variance. Protocols and the registry
 * disagree on optional matres lectionis (מלביצקי / מילביצקי, עטיה / עטייה) and
 * on whether a compound surname is one word (אלהואשלה / אל הואשלה). Collapsing
 * doubled yod and vav and removing spaces reconciles those without loosening
 * what counts as a match — a key is only used when it resolves to exactly one
 * person.
 */
const loose = (s: string) =>
  normalise(s).replace(/יי/g, "י").replace(/וו/g, "ו").replace(/\s+/g, "");

async function buildIndex() {
  const people = await prisma.person.findMany({ select: { personId: true, firstName: true, lastName: true } });

  const full = new Map<string, number[]>();
  // Protocols often drop a middle name ("מיכאל ביטון" for "מיכאל מרדכי ביטון"),
  // so also index first-plus-last. Only used when it resolves uniquely.
  const shortName = new Map<string, number[]>();
  const looseIndex = new Map<string, number[]>();
  // (first token, any surname token). Protocols sometimes carry only part of a
  // compound surname — "אפרת רייטן" for "אפרת רייטן מרום".
  const tokenIndex = new Map<string, number[]>();

  // Deduplicate ids per key. Without this, anyone whose first name is a single
  // token gets indexed twice under the same key (once as "first last", once as
  // "firstToken last"), and a perfectly unique person then looks ambiguous.
  const add = (map: Map<string, number[]>, key: string, id: number) => {
    const existing = map.get(key) ?? [];
    if (!existing.includes(id)) map.set(key, [...existing, id]);
  };

  for (const p of people) {
    const first = (p.firstName ?? "").trim();
    const last = (p.lastName ?? "").trim();
    for (const k of [`${first} ${last}`, `${last} ${first}`]) add(full, normalise(k), p.personId);
    const firstToken = first.split(/\s+/)[0];
    if (firstToken && firstToken !== first) add(shortName, normalise(`${firstToken} ${last}`), p.personId);
    for (const k of [`${first} ${last}`, `${firstToken} ${last}`]) add(looseIndex, loose(k), p.personId);
    for (const token of last.split(/\s+/).filter(Boolean)) {
      add(tokenIndex, loose(`${firstToken} ${token}`), p.personId);
    }
  }
  return { full, shortName, looseIndex, tokenIndex };
}

function resolve(name: string, index: Awaited<ReturnType<typeof buildIndex>>): number | null {
  const key = normalise(name);
  const exact = index.full.get(key);
  if (exact?.length === 1) return exact[0];
  if (exact && exact.length > 1) return null; // ambiguous — never guess
  const short = index.shortName.get(key);
  if (short?.length === 1) return short[0];
  if (short && short.length > 1) return null;
  const fuzzy = index.looseIndex.get(loose(name));
  if (fuzzy?.length === 1) return fuzzy[0];
  if (fuzzy && fuzzy.length > 1) return null;

  // A partial surname: first token plus any one surname token.
  const parts = normalise(name).split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const candidates = new Set<number>();
    for (const token of parts.slice(1)) {
      for (const id of index.tokenIndex.get(loose(`${parts[0]} ${token}`)) ?? []) candidates.add(id);
    }
    if (candidates.size === 1) return [...candidates][0];
    if (candidates.size > 1) return null;
  }

  // Last resort: a single-character difference, which covers the optional
  // matres lectionis Hebrew allows ("מלביצקי" / "מילביצקי") and simple typos.
  // Only accepted when exactly one person is that close — if two are, the name
  // is genuinely ambiguous and is dropped.
  const looseKey = loose(name);
  let hit: number | null = null;
  for (const [candidate, ids] of index.looseIndex) {
    if (Math.abs(candidate.length - looseKey.length) > 1) continue;
    if (!withinOneEdit(candidate, looseKey)) continue;
    for (const id of ids) {
      if (hit !== null && hit !== id) return null;
      hit = id;
    }
  }
  return hit;
}

/** True when `a` and `b` differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return edits + (long.length - j) + (short.length - i) <= 1;
}

async function main() {
  if (!existsSync(JSONL)) {
    console.error(`${JSONL} not found — run scripts/protocols/extract_attendance.py first.`);
    process.exitCode = 1;
    return;
  }

  const index = await buildIndex();
  const sessions = new Set(
    (await prisma.committeeSession.findMany({ select: { committeeSessionId: true } })).map((s) => s.committeeSessionId),
  );
  const documents = new Set((await prisma.sessionDocument.findMany({ select: { id: true } })).map((d) => d.id));

  const stats = { protocols: 0, rows: 0, matched: 0, unmatched: 0, chairs: 0, skippedSession: 0 };
  const unmatched = new Map<string, number>();
  let batch: Array<{ sessionId: number; personId: number; name: string; role: string; title: string | null; documentId: string | null }> = [];

  async function flush() {
    if (!batch.length || DRY_RUN) { batch = []; return; }
    await prisma.$transaction(
      batch.map((r) => {
        const data = {
          committeeSessionId: r.sessionId,
          personId: r.personId,
          speakerName: r.name,
          role: r.role,
          roleDetail: r.title,
          sourceDocumentId: r.documentId,
          extractedBy: EXTRACTED_BY,
          extractedAt: new Date(),
        };
        return prisma.committeeParticipant.upsert({
          where: { committeeSessionId_speakerName: { committeeSessionId: r.sessionId, speakerName: r.name } },
          create: data,
          update: data,
        });
      }),
    );
    batch = [];
  }

  const rl = createInterface({ input: createReadStream(JSONL, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: Record_;
    try { rec = JSON.parse(line); } catch { continue; }
    stats.protocols++;

    if (!sessions.has(rec.committeeSessionId)) { stats.skippedSession++; continue; }
    const documentId = documents.has(rec.documentId) ? rec.documentId : null;
    const chairKey = rec.chair ? normalise(rec.chair) : null;

    for (const [section, role] of [["members", "member"], ["mks", "mk"]] as const) {
      for (const entry of rec.sections[section] ?? []) {
        stats.rows++;
        const personId = resolve(entry.name, index);
        if (personId == null) {
          stats.unmatched++;
          unmatched.set(entry.name, (unmatched.get(entry.name) ?? 0) + 1);
          continue;
        }
        stats.matched++;
        const isChair = role === "member" && chairKey !== null && normalise(entry.name) === chairKey;
        if (isChair) stats.chairs++;
        batch.push({
          sessionId: rec.committeeSessionId,
          personId,
          name: entry.name,
          role: isChair ? "chair" : role,
          title: entry.title,
          documentId,
        });
      }
    }
    if (batch.length >= 400) await flush();
    if (stats.protocols % 1000 === 0) process.stdout.write(`\r  … ${stats.protocols} protocols, ${stats.matched} rows`);
  }
  await flush();
  process.stdout.write("\r".padEnd(60) + "\r");

  console.log(`protocols read      : ${stats.protocols}`);
  console.log(`  session not held  : ${stats.skippedSession}`);
  console.log(`member/MK names     : ${stats.rows}`);
  console.log(`  matched & stored  : ${stats.matched} (${((100 * stats.matched) / stats.rows).toFixed(1)}%)`);
  console.log(`  unmatched, dropped: ${stats.unmatched} (${unmatched.size} distinct)`);
  console.log(`  chair rows        : ${stats.chairs}`);
  if (unmatched.size) {
    console.log("\nmost frequent unmatched:");
    for (const [n, c] of [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${String(c).padStart(4)}  ${JSON.stringify(n)}`);
    }
  }
  if (!DRY_RUN) console.log(`\nCommitteeParticipant rows: ${await prisma.committeeParticipant.count()}`);
}

main()
  .catch((err) => { console.error("\nLoad failed:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
