import { normalizeText, sha256Hex } from "./hash";
import type { RawReview } from "./review-source";

export const REVIEWS_COLUMNS = [
  "review_id",
  "posted_at",
  "stars",
  "text",
  "text_hash",
  "reviewer_name",
  "owner_reply",
  "owner_reply_at",
  "review_url",
  "first_seen_at",
  "last_seen_at",
] as const;

export interface UpsertPlan {
  newRows: string[][];
  updates: { rowNumber: number; values: string[] }[];
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * existingRows: data rows only (no header), in sheet order, so row i sits at
 * sheet row i+2 (1-indexed, header occupies row 1).
 */
export async function planUpsert(
  raw: RawReview[],
  existingRows: string[][],
  now: string,
): Promise<UpsertPlan> {
  const byId = new Map<string, { rowNumber: number; row: string[] }>();
  existingRows.forEach((row, i) => {
    if (row[0]) byId.set(row[0], { rowNumber: i + 2, row });
  });

  const plan: UpsertPlan = { newRows: [], updates: [], inserted: 0, updated: 0, unchanged: 0 };

  for (const r of raw) {
    const text = r.text ?? "";
    const textHash = await sha256Hex(normalizeText(text));
    const existing = byId.get(r.reviewId);

    if (!existing) {
      plan.newRows.push([
        r.reviewId,
        r.postedAt,
        String(r.stars),
        text,
        textHash,
        r.reviewerName ?? "",
        r.ownerReplyText ?? "",
        r.ownerReplyAt ?? "",
        r.reviewUrl ?? "",
        now,
        now,
      ]);
      plan.inserted++;
      continue;
    }

    const firstSeenAt = existing.row[9] || now;
    const textChanged = existing.row[4] !== textHash;

    plan.updates.push({
      rowNumber: existing.rowNumber,
      values: [
        r.reviewId,
        r.postedAt,
        String(r.stars),
        text,
        textHash,
        r.reviewerName ?? "",
        r.ownerReplyText ?? "",
        r.ownerReplyAt ?? "",
        r.reviewUrl ?? "",
        firstSeenAt,
        now,
      ],
    });
    if (textChanged) plan.updated++;
    else plan.unchanged++;
  }

  return plan;
}
