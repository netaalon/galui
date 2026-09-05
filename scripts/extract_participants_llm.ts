/**
 * Phase 2 (stub) — extract committee-session participants from a protocol.
 *
 * The Knesset OData service publishes the protocol *files*
 * (KNS_DocumentCommitteeSession.FilePath) but never says who actually spoke in
 * a session. This script closes that gap with an LLM pass over the protocol
 * text and writes the result into the `CommitteeParticipant` table.
 *
 * Usage:
 *   npx tsx scripts/extract_participants_llm.ts --session=2244838 --file=protocol.txt
 *   npx tsx scripts/extract_participants_llm.ts --session=2244838 --file=p.txt --provider=gemini
 *   npx tsx scripts/extract_participants_llm.ts --session=2244838 --file=p.txt --dry-run
 *
 * Options:
 *   --session=<id>     KNS_CommitteeSession.CommitteeSessionID (required)
 *   --file=<path>      Plain-text protocol (required; see "Getting the text")
 *   --prompt=<path>    System prompt (default: prompts/extract-participants.he.txt)
 *   --provider=<name>  openai | gemini | anthropic   (default: openai)
 *   --model=<name>     Overrides the provider default
 *   --document=<id>    KNS_DocumentCommitteeSession id the text came from
 *   --dry-run          Print the parsed result, write nothing
 *
 * Set the matching key before running:
 *   OPENAI_API_KEY= / GEMINI_API_KEY= / ANTHROPIC_API_KEY=
 *
 * ── Getting the text ────────────────────────────────────────────────────────
 * Protocols are legacy Word (.doc) files. Convert one first, e.g.:
 *   curl -sL "$(sqlite3 prisma/dev.db 'select filePath from SessionDocument limit 1')" -o p.doc
 *   libreoffice --headless --convert-to txt p.doc
 *
 * ── Status ──────────────────────────────────────────────────────────────────
 * The provider calls below are written against each vendor's documented REST
 * shape but have NOT been executed — no API key was available when this was
 * written. Treat the first live run as the integration test.
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedParticipant {
  speakerName: string;
  role: "chair" | "mk" | "minister" | "official" | "advisor" | "guest" | "unknown";
  timesSpoken: number;
  confidence: number;
}

interface ExtractionResult {
  participants: ExtractedParticipant[];
}

type Provider = "openai" | "gemini" | "anthropic";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-sonnet-5",
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const has = (name: string) => process.argv.includes(`--${name}`);

// ---------------------------------------------------------------------------
// Providers
//
// Each returns the model's raw text; parsing is shared below. Swap in an SDK
// if you prefer — the contract is (systemPrompt, userText, model) => string.
// ---------------------------------------------------------------------------

async function callOpenAI(system: string, user: string, model: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

async function callGemini(system: string, user: string, model: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callAnthropic(system: string, user: string, model: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

const PROVIDERS: Record<Provider, (s: string, u: string, m: string) => Promise<string>> = {
  openai: callOpenAI,
  gemini: callGemini,
  anthropic: callAnthropic,
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Models sometimes wrap JSON in a ```json fence despite being told not to. */
export function parseResult(raw: string): ExtractionResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Model did not return valid JSON:\n${raw.slice(0, 500)}`);
  }

  const list = (parsed as ExtractionResult)?.participants;
  if (!Array.isArray(list)) throw new Error(`Missing "participants" array in model output.`);

  return {
    participants: list
      .filter((p) => typeof p?.speakerName === "string" && p.speakerName.trim())
      .map((p) => ({
        speakerName: p.speakerName.trim(),
        role: p.role ?? "unknown",
        timesSpoken: Number.isFinite(p.timesSpoken) ? Number(p.timesSpoken) : 0,
        confidence: Number.isFinite(p.confidence) ? Number(p.confidence) : 0,
      })),
  };
}

/**
 * Extract participants from protocol text. Exported so an ingestion job can
 * call it directly instead of shelling out.
 */
export async function extract_participants_llm(
  protocolText: string,
  systemPrompt: string,
  opts: { provider?: Provider; model?: string } = {},
): Promise<ExtractionResult> {
  const provider = opts.provider ?? "openai";
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const raw = await PROVIDERS[provider](systemPrompt, protocolText, model);
  return parseResult(raw);
}

/**
 * Best-effort match of a protocol speaker name to a Person row.
 *
 * Protocols write names as "משה אבוטבול" while the API stores first and last
 * separately, so an exact "first last" comparison catches most of them. Anything
 * ambiguous is stored unmatched (personId null) rather than guessed at.
 */
export async function matchPeople(prisma: PrismaClient, names: string[]) {
  const members = await prisma.person.findMany({
    where: { isMk: true },
    select: { personId: true, firstName: true, lastName: true },
  });

  const index = new Map<string, number[]>();
  for (const m of members) {
    for (const key of [`${m.firstName} ${m.lastName}`, `${m.lastName} ${m.firstName}`]) {
      const norm = key.replace(/\s+/g, " ").trim();
      index.set(norm, [...(index.get(norm) ?? []), m.personId]);
    }
  }

  const out = new Map<string, number | null>();
  for (const name of names) {
    const hits = index.get(name.replace(/\s+/g, " ").trim()) ?? [];
    out.set(name, hits.length === 1 ? hits[0] : null); // ambiguous → leave unmatched
  }
  return out;
}

/**
 * Persist extracted speakers, resolving each to a Person where the name is
 * unambiguous. Upserted on (session, speakerName) so re-running a session
 * refreshes rather than duplicates.
 */
export async function saveParticipants(
  prisma: PrismaClient,
  sessionId: number,
  participants: ExtractedParticipant[],
  meta: { documentId?: string | null; extractionModel?: string } = {},
): Promise<{ written: number; matched: number }> {
  const session = await prisma.committeeSession.findUnique({ where: { committeeSessionId: sessionId } });
  if (!session) throw new Error(`Session ${sessionId} is not in the local database — run the ETL first.`);

  const matches = await matchPeople(prisma, participants.map((p) => p.speakerName));

  for (const p of participants) {
    const data = {
      committeeSessionId: sessionId,
      personId: matches.get(p.speakerName) ?? null,
      speakerName: p.speakerName,
      role: p.role,
      timesSpoken: p.timesSpoken,
      sourceDocumentId: meta.documentId ?? null,
      matchConfidence: p.confidence,
      extractionModel: meta.extractionModel ?? null,
      extractedAt: new Date(),
    };
    await prisma.committeeParticipant.upsert({
      where: { committeeSessionId_speakerName: { committeeSessionId: sessionId, speakerName: p.speakerName } },
      create: data,
      update: data,
    });
  }

  return { written: participants.length, matched: [...matches.values()].filter(Boolean).length };
}

async function main() {
  const sessionId = Number(flag("session"));
  const file = flag("file");
  const promptPath = flag("prompt") ?? "prompts/extract-participants.he.txt";
  const provider = (flag("provider") ?? "openai") as Provider;
  const model = flag("model") ?? DEFAULT_MODELS[provider];
  const documentId = flag("document") ?? null;
  const dryRun = has("dry-run");

  if (!Number.isInteger(sessionId) || !file) {
    console.error("Usage: tsx scripts/extract_participants_llm.ts --session=<id> --file=<protocol.txt> [--dry-run]");
    console.error("Run with no key set and --dry-run to see the parse path without calling a provider.");
    process.exit(1);
  }
  if (!(provider in PROVIDERS)) {
    console.error(`Unknown provider "${provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
    process.exit(1);
  }

  const [protocolText, systemPrompt] = await Promise.all([
    readFile(file, "utf8"),
    readFile(promptPath, "utf8"),
  ]);

  console.log(`Session ${sessionId} · ${provider}/${model} · ${protocolText.length.toLocaleString()} chars`);

  const result = await extract_participants_llm(protocolText, systemPrompt, { provider, model });
  console.log(`Extracted ${result.participants.length} speakers.`);

  if (dryRun) {
    console.table(result.participants);
    return;
  }

  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
  const prisma = new PrismaClient({ adapter });

  try {
    const { written, matched } = await saveParticipants(prisma, sessionId, result.participants, {
      documentId,
      extractionModel: `${provider}/${model}`,
    });
    console.log(`Wrote ${written} participants (${matched} matched to a known MK).`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the CLI when invoked directly, so the export stays importable.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((err) => {
    console.error("\nExtraction failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
