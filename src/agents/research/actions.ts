import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";

import type { Verification } from "@/graph/types";
import {
  emitter,
  ensureSource,
  fieldTarget,
  formatSources,
  oneLine,
  quote,
  quoteIsIn,
  research,
  restatesClaim,
  sourceIds,
  streamFindings,
  UNTRUSTED_SOURCES,
  type Configurable,
  type Emitter,
} from "./kit";
import { streamClaude } from "./llm";
import { GraphEvent, type ActionRequest, type ActionTarget } from "./protocol";
import { createRecordStream, type ParsedRecord } from "./record-stream";
import { researchScheduler } from "./scheduler";

/**
 * User-initiated investigations of one node. Each is at most one Firecrawl
 * search plus one streaming Claude request, runs through the shared scheduler
 * with priority over automatic research, and only keeps nodes grounded in
 * retrieved pages.
 */

type Result = { message: string; added: number };

export const guidanceOf = (t: ActionTarget) =>
  t.context?.length ? `\nUser guidance (follow it): ${t.context.join(" ")}` : "";

const contextOf = (t: ActionTarget) =>
  `Research question: ${t.path[0] ?? t.label}\nLocation in the research map: ${[...t.path, t.label].join(" > ")}${guidanceOf(t)}`;

const describe = (t: ActionTarget) => `${t.label}${t.description ? ` — ${t.description}` : ""}`;

/** Removes a provisional node that failed validation (e.g. a quote not found in its source). */
const remove = (e: Emitter, researchId: string, branchId: string, nodeId: string) =>
  e.write({ type: "graph", event: { name: GraphEvent.NodeRemoved, value: { researchId, branchId, nodeId } } });

// --- Deep Dive: one more research level under the node ---------------------------------

async function deepDive(a: ActionRequest, e: Emitter, ctx: Configurable, config: LangGraphRunnableConfig): Promise<Result> {
  const t = a.target;
  const short = t.label.split(/\s+/).length < 6;
  const query = short && t.path[0] ? `${t.label} ${t.path[0]}` : t.label;
  const sources = await research(e, ctx, a.actionId, query.slice(0, 200), describe(t));
  const findings = await streamFindings({
    e,
    ctx,
    config,
    role: "deepDive",
    branchId: a.actionId,
    parentId: t.id,
    idPrefix: a.actionId,
    prompt:
      `${contextOf(t)}\nTopic to investigate one level deeper: ${describe(t)}\n` +
      `Already known under this topic (do not repeat): ${t.children.join("; ") || "nothing yet"}`,
    sources,
  });
  return {
    added: findings.length,
    message: findings.length
      ? `Deep Dive added ${findings.length} findings from ${sources.length} sources.`
      : "Deep Dive found nothing new to add.",
  };
}

// --- Challenge: search for evidence against a claim ----------------------------------------

const CHALLENGE_SYSTEM = `You are the Critic of a research assistant. You receive one claim and web sources
retrieved while searching for evidence that challenges it.

${UNTRUSTED_SOURCES}

Report only what the sources actually show, at most 3 records:
- contradiction: a source presents evidence or expert findings that the claim is false, overstated or wrong.
- alternative: a source offers a different explanation or perspective that competes with the claim
  without showing it is false.
Never invent counterarguments, and do not report sources that agree with the claim.
Every COUNTER must cite at least one source and include a QUOTE: a sentence (6 to 25 words) copied exactly
from it that states the counter-evidence. Titles and headings are not evidence.
If no source genuinely challenges the claim, output exactly one NONE record instead.

Output ONLY records in exactly this format, no other text, no markdown:

COUNTER
TYPE: contradiction | alternative
TITLE: <the counterpoint as a claim, at most 10 words>
SUMMARY: <one sentence, at most 30 words>
SOURCES: <comma-separated source ids>
QUOTE: <verbatim excerpt>

NONE
REASON: <one sentence on what the sources show instead>

Each field value stays on one line.`;

const CounterSchema = z.object({
  TYPE: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(["contradiction", "alternative"])),
  TITLE: oneLine(140),
  SUMMARY: oneLine(600),
  SOURCES: sourceIds,
  QUOTE: quote,
});

async function challenge(a: ActionRequest, e: Emitter, ctx: Configurable, config: LangGraphRunnableConfig): Promise<Result> {
  const t = a.target;
  const known = new Set(ctx.knownSources.keys());
  const sources = await research(e, ctx, a.actionId, `${t.label} criticism evidence against`.slice(0, 200), describe(t), known);
  if (!sources.length) return { added: 0, message: "No new sources found to challenge this claim." };

  const byId = new Map(sources.map((s) => [s.id, s]));
  const counterId = (r: ParsedRecord) => `${a.actionId}:c${r.index + 1}`;
  let contradictions = 0;
  let alternatives = 0;
  let noneReason = "";
  const created = new Set<number>();

  const parser = createRecordStream({
    kinds: ["COUNTER", "NONE"],
    streamedFields: ["TITLE", "SUMMARY"],
    onRecordStart: () => {},
    onFieldDelta: (r, field, delta) => {
      if (r.kind !== "COUNTER") return;
      // TYPE precedes the streamed fields, so the edge kind is known at creation.
      if (!created.has(r.index)) {
        created.add(r.index);
        const contradiction = (r.fields.TYPE ?? "").toLowerCase().includes("contradiction");
        e.created(counterId(r), "claim", {}, true);
        e.edge(counterId(r), contradiction ? "contradicts" : "related_to", t.id);
      }
      e.text(counterId(r), fieldTarget(field), delta);
    },
    onRecordEnd: (r) => {
      if (r.kind === "NONE") {
        noneReason = (r.fields.REASON ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
        return;
      }
      const id = counterId(r);
      const parsed = CounterSchema.safeParse(r.fields);
      const c = parsed.success ? parsed.data : null;
      const cited = c ? c.SOURCES.filter((sid) => byId.has(sid)) : [];
      const quotedSid =
        c?.QUOTE && !restatesClaim(c.QUOTE, t.label) ? cited.find((sid) => quoteIsIn(c.QUOTE!, byId.get(sid)!)) : undefined;
      // Grounding rule: a counterpoint survives only with a real source that contains its quote.
      if (!c || !quotedSid) {
        if (created.has(r.index)) remove(e, a.target.id, a.actionId, id);
        return;
      }
      if (!created.has(r.index)) {
        e.created(id, "claim", {}, true);
        e.edge(id, c.TYPE === "contradiction" ? "contradicts" : "related_to", t.id);
      }
      const sourceNodeIds = cited.map((sid) => ensureSource(e, ctx, byId.get(sid)!));
      e.completed(id, {
        label: c.TITLE,
        description: c.SUMMARY,
        challenge: c.TYPE,
        verification: "verified",
        sourceIds: sourceNodeIds,
      });
      if (c.TYPE === "contradiction") contradictions++;
      else alternatives++;

      const evId = `${id}:evidence`;
      const quotedNode = sourceNodeIds[cited.indexOf(quotedSid)];
      e.created(evId, "evidence", { stance: c.TYPE === "contradiction" ? "conflicting" : "neutral", quote: c.QUOTE });
      e.edge(evId, "supports", id);
      e.text(evId, "label", `“${c.QUOTE}”`);
      e.completed(evId);
      e.edge(evId, "sourced_from", quotedNode);
      for (const nodeId of sourceNodeIds) if (nodeId !== quotedNode) e.edge(id, "sourced_from", nodeId);
    },
  });

  const { usage } = await streamClaude({
    role: "challenge",
    branchId: a.actionId,
    system: CHALLENGE_SYSTEM,
    prompt: `${contextOf(t)}\nClaim to challenge: ${describe(t)}\n\n${formatSources(sources)}`,
    effort: "medium",
    maxTokens: 6000,
    signal: config.signal,
    onText: parser.push,
  });
  parser.end();
  e.usage({ kind: "llm", ...usage });

  if (contradictions) e.completed(t.id, { verification: "contested", contested: true });
  const added = contradictions + alternatives;
  if (!added)
    return {
      added: 0,
      message: `No credible contradiction found in ${sources.length} sources.${noneReason ? ` ${noneReason}` : ""}`,
    };
  const parts = [
    contradictions && `${contradictions} contradiction${contradictions > 1 ? "s" : ""}`,
    alternatives && `${alternatives} alternative view${alternatives > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return { added, message: `Challenge found ${parts.join(" and ")}.` };
}

// --- Find Evidence: new sources for or against a claim -----------------------------------------

const EVIDENCE_SYSTEM = `You check a claim against newly retrieved web sources.

${UNTRUSTED_SOURCES}

For each source that bears directly on the claim, output one EVIDENCE record; skip sources that are
unrelated or only mention the topic. At most 4 records.
STANCE is supports or disputes. QUOTE is a verbatim sentence (6 to 25 words) copied exactly from the source that
states a finding; titles and headings are not evidence. Only use disputes when the quote itself argues against the claim.
NOTE is one sentence (at most 20 words) on how the source bears on the claim.

Output ONLY records in exactly this format, no other text, no markdown:

EVIDENCE
SOURCE: <one source id>
STANCE: supports | disputes
QUOTE: <verbatim excerpt>
NOTE: <how it bears on the claim>

Each field value stays on one line. If no source bears on the claim, output nothing.`;

const EvidenceSchema = z.object({
  SOURCE: sourceIds,
  STANCE: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(["supports", "disputes"])),
  QUOTE: quote,
  NOTE: oneLine(300).optional(),
});

async function findEvidence(a: ActionRequest, e: Emitter, ctx: Configurable, config: LangGraphRunnableConfig): Promise<Result> {
  const t = a.target;
  const known = new Set(ctx.knownSources.keys());
  const sources = await research(e, ctx, a.actionId, `${t.label} evidence study`.slice(0, 200), describe(t), known);
  if (!sources.length) return { added: 0, message: "No new sources found for this claim." };

  const byId = new Map(sources.map((s) => [s.id, s]));
  const evidenceId = (r: ParsedRecord) => `${a.actionId}:e${r.index + 1}`;
  let supports = 0;
  let disputes = 0;
  const createdEv = new Set<number>();

  const parser = createRecordStream({
    kinds: ["EVIDENCE"],
    streamedFields: ["QUOTE", "NOTE"],
    onRecordStart: () => {},
    onFieldDelta: (r, field, delta) => {
      // STANCE precedes QUOTE, so the relationship is known when the node appears.
      if (!createdEv.has(r.index)) {
        createdEv.add(r.index);
        const disputing = (r.fields.STANCE ?? "").toLowerCase().includes("dispute");
        e.created(evidenceId(r), "evidence", { stance: disputing ? "conflicting" : "supporting" });
        e.edge(evidenceId(r), disputing ? "contradicts" : "supports", t.id);
      }
      e.text(evidenceId(r), field === "QUOTE" ? "label" : "description", delta);
    },
    onRecordEnd: (r) => {
      const id = evidenceId(r);
      const parsed = EvidenceSchema.safeParse(r.fields);
      const ev = parsed.success ? parsed.data : null;
      const sid = ev?.SOURCE.find((s) => byId.has(s));
      if (!ev || !sid || !ev.QUOTE || restatesClaim(ev.QUOTE, t.label) || !quoteIsIn(ev.QUOTE, byId.get(sid)!)) {
        if (createdEv.has(r.index)) remove(e, t.id, a.actionId, id);
        return;
      }
      if (!createdEv.has(r.index)) {
        e.created(id, "evidence", {});
        e.edge(id, ev.STANCE === "disputes" ? "contradicts" : "supports", t.id);
      }
      const sourceNode = ensureSource(e, ctx, byId.get(sid)!);
      const disputing = ev.STANCE === "disputes";
      e.completed(id, {
        label: `“${ev.QUOTE}”`,
        description: ev.NOTE,
        quote: ev.QUOTE,
        stance: disputing ? "conflicting" : "supporting",
      });
      e.edge(id, "sourced_from", sourceNode);
      if (disputing) disputes++;
      else supports++;
    },
  });

  const { usage } = await streamClaude({
    role: "evidence",
    branchId: a.actionId,
    system: EVIDENCE_SYSTEM,
    prompt: `${contextOf(t)}\nClaim: ${describe(t)}\n\n${formatSources(sources)}`,
    effort: "low",
    maxTokens: 4000,
    signal: config.signal,
    onText: parser.push,
  });
  parser.end();
  e.usage({ kind: "llm", ...usage });

  if (!supports && !disputes) return { added: 0, message: `None of ${sources.length} new sources bear directly on this claim.` };
  // Status follows the grounded evidence, combined with what the claim already had.
  const hadSupport = t.verification === "verified" || supports > 0;
  const verification: Verification = disputes ? "contested" : hadSupport ? "verified" : "unverified";
  e.completed(t.id, { verification, contested: verification === "contested" });
  return {
    added: supports + disputes,
    message: `Found ${supports} supporting and ${disputes} disputing source${supports + disputes > 1 ? "s" : ""}; status: ${verification}.`,
  };
}

// --- Research Gaps: suggestions only, nothing is researched automatically -------------------------

const GAPS_SYSTEM = `You review one branch of a research map and point out its gaps.
Suggest at most 3 gaps, and only ones that matter: a meaningful unanswered question about this branch's subject,
or a key claim that lacks evidence. If the branch already covers its subject adequately, output nothing.
Never suggest generic questions just to fill the map. Each gap is a focused research question:
- unanswered: an important question the branch does not address
- missing-evidence: a claim that is unverified or weakly supported
- overlooked: a plausible explanation or factor the branch ignores
Do not repeat questions that are already answered in the branch.

Output ONLY records in exactly this format, no other text, no markdown:

GAP
TYPE: unanswered | missing-evidence | overlooked
QUESTION: <research question, at most 14 words>
WHY: <one sentence, at most 20 words>

Each field value stays on one line.`;

const GapSchema = z.object({
  TYPE: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(["unanswered", "missing-evidence", "overlooked"]))
    .catch("unanswered"),
  QUESTION: oneLine(200),
  WHY: oneLine(300).optional(),
});

async function gaps(a: ActionRequest, e: Emitter, config: LangGraphRunnableConfig): Promise<Result> {
  const t = a.target;
  const gapId = (r: ParsedRecord) => `${a.actionId}:g${r.index + 1}`;
  let added = 0;
  const parser = createRecordStream({
    kinds: ["GAP"],
    streamedFields: ["QUESTION", "WHY"],
    onRecordStart: (r) => {
      if (r.index >= 3) return;
      e.created(gapId(r), "question", { status: "open", gap: "unanswered", parentQuestionId: t.questionId });
      e.edge(gapId(r), "related_to", t.id);
    },
    onFieldDelta: (r, field, delta) => {
      if (r.index < 3) e.text(gapId(r), field === "QUESTION" ? "label" : "description", delta);
    },
    onRecordEnd: (r) => {
      if (r.index >= 3) return;
      const parsed = GapSchema.safeParse(r.fields);
      if (!parsed.success) return remove(e, t.id, a.actionId, gapId(r));
      e.completed(gapId(r), { label: parsed.data.QUESTION, description: parsed.data.WHY, gap: parsed.data.TYPE });
      added++;
    },
  });

  const branch = (t.branch ?? [])
    .slice(0, 40)
    .map((n) => `- [${n.kind}${n.verification ? `, ${n.verification}` : ""}] ${n.label}`)
    .join("\n");
  const { usage } = await streamClaude({
    role: "gaps",
    branchId: a.actionId,
    system: GAPS_SYSTEM,
    prompt: `${contextOf(t)}\nBranch under review: ${describe(t)}\nWhat the branch contains:\n${branch || "- (nothing yet)"}`,
    effort: "low",
    maxTokens: 3000,
    signal: config.signal,
    onText: parser.push,
  });
  parser.end();
  e.usage({ kind: "llm", ...usage });
  return { added, message: added ? `Suggested ${added} research gaps. Select one to research it.` : "No clear gaps found." };
}

// --- Entry point ----------------------------------------------------------------------------------

export async function runAction(action: ActionRequest, config: LangGraphRunnableConfig): Promise<Result> {
  const ctx = config.configurable as Configurable;
  const e = emitter(config, action.target.id, action.actionId);
  return researchScheduler.run(async () => {
    switch (action.kind) {
      case "deepDive":
        return deepDive(action, e, ctx, config);
      case "challenge":
        return challenge(action, e, ctx, config);
      case "findEvidence":
        return findEvidence(action, e, ctx, config);
      case "gaps":
        return gaps(action, e, config);
      case "followUp":
        throw new Error("Follow-up questions run through the research planner.");
    }
  }, "user");
}

