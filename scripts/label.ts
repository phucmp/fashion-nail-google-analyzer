import "./_env";
import Anthropic from "@anthropic-ai/sdk";
import { appendRows, getSheetRows } from "../lib/sheets";
import { matchesRoster } from "../lib/roster-match";
import { parseLabelRows, parseReviewRows, parseRosterRows } from "../lib/sheet-parse";
import type { StaffMentionLabel } from "../lib/metrics";

const REQUIRED = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID"] as const;
for (const key of REQUIRED) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .dev.vars`);
}

const PROMPT_VERSION = "v1";
const BATCH_SIZE = 20;
const MAX_REVIEW_CHARS = 2000;

const env = { GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, SHEET_ID: process.env.SHEET_ID! };
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const [reviewRows, labelRows, rosterRows] = await Promise.all([
  getSheetRows(env, "reviews"),
  getSheetRows(env, "labels"),
  getSheetRows(env, "roster"),
]);
const reviews = parseReviewRows(reviewRows.slice(1));
const labels = parseLabelRows(labelRows.slice(1));
const roster = parseRosterRows(rosterRows.slice(1));

// Re-label a review if it's new, or its text changed since it was last labeled (textHash mismatch).
const labelByReviewId = new Map(labels.map((l) => [l.reviewId, l]));
const pending = reviews.filter((r) => labelByReviewId.get(r.reviewId)?.textHash !== r.textHash);

console.log(`${pending.length} review(s) need labeling (of ${reviews.length} total).`);
if (!pending.length) process.exit(0);
if (!roster.length) console.warn("Roster tab is empty — every staff mention will be logged as unmatched until it's filled in.");

const LABEL_TOOL: Anthropic.Tool = {
  name: "label_reviews",
  description: "Records the sentiment and staff mentions for a batch of reviews.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            reviewId: { type: "string" },
            sentiment: { type: "string", enum: ["positive", "mixed", "negative"] },
            staffMentions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Staff member's name as it appears in the review" },
                  polarity: { type: "string", enum: ["praised", "criticized", "neutral"] },
                  evidence: { type: "string", description: "Short quote or paraphrase from the review supporting this" },
                },
                required: ["name", "polarity", "evidence"],
                additionalProperties: false,
              },
            },
          },
          required: ["reviewId", "sentiment", "staffMentions"],
          additionalProperties: false,
        },
      },
    },
    required: ["labels"],
    additionalProperties: false,
  },
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface ClaudeLabel {
  reviewId: string;
  sentiment: "positive" | "mixed" | "negative";
  staffMentions: { name: string; polarity: "praised" | "criticized" | "neutral"; evidence: string }[];
}

const rosterNames = roster.filter((r) => r.active).map((r) => r.name);
const now = new Date().toISOString();
const newLabelRows: string[][] = [];
const newUnmatchedRows: string[][] = [];
const seenUnmatched = new Set<string>();
let labeledCount = 0;

for (const batch of chunk(pending, BATCH_SIZE)) {
  const prompt = `You are labeling customer reviews for a nail salon, one batch at a time.

Known staff on the roster (match a mention to one of these when it's clearly the same person): ${
    rosterNames.length ? rosterNames.join(", ") : "(none yet)"
  }

For each review, determine:
- sentiment: "positive", "mixed", or "negative" overall tone
- staffMentions: any staff/employee named or clearly referenced, with whether the review praises, criticizes, or is neutral toward them, plus a short quote/paraphrase as evidence. Reviews with no staff mention get an empty array.

Reviews:
${batch.map((r) => `[${r.reviewId}] (${r.stars}★) ${(r.text || "").slice(0, MAX_REVIEW_CHARS)}`).join("\n\n")}`;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL!,
    max_tokens: 8000,
    tools: [LABEL_TOOL],
    tool_choice: { type: "auto" },
    system: "Use the label_reviews tool to return your analysis. Call it exactly once per batch, covering every review listed.",
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "label_reviews",
  );
  if (!toolUse) {
    console.warn(`No tool call in response for batch starting at ${batch[0].reviewId}; will retry next run.`);
    continue;
  }
  const { labels: batchLabels } = toolUse.input as { labels: ClaudeLabel[] };

  for (const l of batchLabels) {
    const review = batch.find((r) => r.reviewId === l.reviewId);
    if (!review) continue;
    const staffMentions: StaffMentionLabel[] = l.staffMentions.map((m) => ({
      name: m.name,
      onRoster: matchesRoster(m.name, roster),
      polarity: m.polarity,
      evidence: m.evidence,
    }));
    for (const m of staffMentions) {
      const key = `${m.name.toLowerCase()}|${review.reviewId}`;
      if (!m.onRoster && !seenUnmatched.has(key)) {
        seenUnmatched.add(key);
        newUnmatchedRows.push([m.name, review.reviewId, now]);
      }
    }
    // topics (themes) aren't extracted yet; left empty until that feature is built.
    newLabelRows.push([
      review.reviewId,
      review.textHash,
      PROMPT_VERSION,
      l.sentiment,
      JSON.stringify([]),
      JSON.stringify(staffMentions),
      now,
      response.model,
    ]);
    labeledCount++;
  }
}

await appendRows(env, "labels", newLabelRows);
await appendRows(env, "unmatched_names", newUnmatchedRows);
console.log(`Labeled ${labeledCount} review(s). ${newUnmatchedRows.length} unmatched staff name(s) logged to unmatched_names for roster review.`);
