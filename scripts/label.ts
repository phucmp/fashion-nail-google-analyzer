import "./_env";
import Anthropic from "@anthropic-ai/sdk";
import { appendRows, getSheetRows } from "../lib/sheets";
import { matchesRoster } from "../lib/roster-match";
import { parseLabelRows, parseReviewRows, parseRosterRows } from "../lib/sheet-parse";
import type { StaffMentionLabel, TopicLabel } from "../lib/metrics";

const REQUIRED = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID"] as const;
for (const key of REQUIRED) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .dev.vars`);
}

// v2 adds theme extraction; bumping this forces every review to be re-labeled once.
const PROMPT_VERSION = "v2";
const BATCH_SIZE = 20;
const MAX_REVIEW_CHARS = 2000;

// Controlled vocabulary, not freeform text, so counts aggregate cleanly into a bar chart
// instead of fragmenting into near-duplicate phrasings.
const POSITIVE_THEMES = [
  "Friendly, welcoming staff",
  "Skilled, talented technicians",
  "Beautiful nail art / designs",
  "Clean, relaxing environment",
  "Great value for the price",
  "Quick, efficient service",
  "Manicure/pedicure lasted well",
  "Attentive, personalized service",
  "Easy to book / convenient",
  "Overall great experience",
] as const;

const FEEDBACK_THEMES = [
  "Long wait times",
  "Pricing felt high",
  "Inconsistent quality between visits",
  "Nails didn't last / chipped early",
  "Service felt rushed",
  "Appointment/scheduling issues",
  "Cleanliness concerns",
  "Communication issues",
  "Limited availability / hard to book",
  "Customer service issues",
] as const;

const env = { GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, SHEET_ID: process.env.SHEET_ID! };
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const [reviewRows, labelRows, rosterRows, unmatchedRows] = await Promise.all([
  getSheetRows(env, "reviews"),
  getSheetRows(env, "labels"),
  getSheetRows(env, "roster"),
  getSheetRows(env, "unmatched_names"),
]);
const reviews = parseReviewRows(reviewRows.slice(1));
const labels = parseLabelRows(labelRows.slice(1));
const roster = parseRosterRows(rosterRows.slice(1));

// Re-label a review if it's new, its text changed (textHash mismatch), or the labeling schema/prompt changed.
const labelByReviewId = new Map(labels.map((l) => [l.reviewId, l]));
const pending = reviews.filter((r) => {
  const existing = labelByReviewId.get(r.reviewId);
  return !existing || existing.textHash !== r.textHash || existing.promptVersion !== PROMPT_VERSION;
});

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
            positiveThemes: {
              type: "array",
              items: { type: "string", enum: [...POSITIVE_THEMES] },
              description: "Which of the listed positive themes this review praises, if any",
            },
            feedbackThemes: {
              type: "array",
              items: { type: "string", enum: [...FEEDBACK_THEMES] },
              description: "Which of the listed improvement themes this review raises, if any",
            },
          },
          required: ["reviewId", "sentiment", "staffMentions", "positiveThemes", "feedbackThemes"],
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
  positiveThemes: string[];
  feedbackThemes: string[];
}

const rosterNames = roster.filter((r) => r.active).map((r) => r.name);
const now = new Date().toISOString();
const newLabelRows: string[][] = [];
const newUnmatchedRows: string[][] = [];
// Seeded with rows already in the sheet so re-labeling (e.g. after a prompt-version bump) doesn't duplicate them.
const seenUnmatched = new Set(unmatchedRows.slice(1).map((r) => `${(r[0] ?? "").toLowerCase()}|${r[1]}`));
let labeledCount = 0;

for (const batch of chunk(pending, BATCH_SIZE)) {
  const prompt = `You are labeling customer reviews for a nail salon, one batch at a time.

Known staff on the roster (match a mention to one of these when it's clearly the same person): ${
    rosterNames.length ? rosterNames.join(", ") : "(none yet)"
  }

For each review, determine:
- sentiment: "positive", "mixed", or "negative" overall tone
- staffMentions: any staff/employee named or clearly referenced, with whether the review praises, criticizes, or is neutral toward them, plus a short quote/paraphrase as evidence. Reviews with no staff mention get an empty array.
- positiveThemes: pick zero or more from this exact list, only when the review clearly praises it: ${POSITIVE_THEMES.join(" | ")}
- feedbackThemes: pick zero or more from this exact list, only when the review clearly raises it: ${FEEDBACK_THEMES.join(" | ")}

Reviews:
${batch.map((r) => `[${r.reviewId}] (${r.stars}★) ${(r.text || "").slice(0, MAX_REVIEW_CHARS)}`).join("\n\n")}`;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL!,
    max_tokens: 8000,
    // Classification against a fixed schema doesn't need deep reasoning; this is the main cost lever.
    output_config: { effort: "low" },
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
  const coveredIds = new Set(batchLabels.map((l) => l.reviewId));
  const missed = batch.filter((r) => !coveredIds.has(r.reviewId));
  if (missed.length) console.warn(`Batch starting at ${batch[0].reviewId} skipped ${missed.length} review(s); will retry next run.`);

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
    const topics: TopicLabel[] = [
      ...l.positiveThemes.map((label) => ({ label, sentiment: "positive" as const })),
      ...l.feedbackThemes.map((label) => ({ label, sentiment: "negative" as const })),
    ];
    newLabelRows.push([
      review.reviewId,
      review.textHash,
      PROMPT_VERSION,
      l.sentiment,
      JSON.stringify(topics),
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
