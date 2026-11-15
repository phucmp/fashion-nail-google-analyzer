import { appendRows, batchUpdateRows, getSheetRows, type Env } from "./sheets";
import { planUpsert, type UpsertPlan } from "./reviews-diff";
import type { RawReview } from "./review-source";

const REVIEWS_TAB = "reviews";

export async function upsertReviews(
  env: Env,
  raw: RawReview[],
  now: string,
): Promise<Omit<UpsertPlan, "newRows" | "updates">> {
  const rows = await getSheetRows(env, REVIEWS_TAB);
  const [, ...existingRows] = rows;
  const plan = await planUpsert(raw, existingRows, now);

  await batchUpdateRows(env, REVIEWS_TAB, plan.updates);
  await appendRows(env, REVIEWS_TAB, plan.newRows);

  return { inserted: plan.inserted, updated: plan.updated, unchanged: plan.unchanged };
}
