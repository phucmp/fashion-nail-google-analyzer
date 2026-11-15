import { describe, expect, it } from "vitest";
import { planUpsert } from "./reviews-diff";
import { normalizeText, sha256Hex } from "./hash";
import type { RawReview } from "./review-source";

function fakeReview(overrides: Partial<RawReview>): RawReview {
  return {
    reviewId: "r1",
    postedAt: "2025-01-01T00:00:00.000Z",
    stars: 5,
    text: "Made-up review text, great service!",
    reviewerName: "Test Reviewer",
    ownerReplyText: null,
    ownerReplyAt: null,
    reviewUrl: "https://example.com/review/r1",
    ...overrides,
  };
}

describe("planUpsert", () => {
  it("inserts a new review", async () => {
    const plan = await planUpsert([fakeReview({})], [], "2025-02-01T00:00:00.000Z");
    expect(plan.inserted).toBe(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.newRows[0][0]).toBe("r1");
    expect(plan.newRows[0][9]).toBe("2025-02-01T00:00:00.000Z");
    expect(plan.newRows[0][10]).toBe("2025-02-01T00:00:00.000Z");
  });

  it("marks an unchanged review as seen again without altering its text_hash or first_seen_at", async () => {
    const hash = await sha256Hex(normalizeText("Made-up review text, great service!"));
    const existingRows = [
      ["r1", "2025-01-01T00:00:00.000Z", "5", "Made-up review text, great service!", hash, "Test Reviewer", "", "", "https://example.com/review/r1", "2025-01-05T00:00:00.000Z", "2025-01-05T00:00:00.000Z"],
    ];
    const plan = await planUpsert([fakeReview({})], existingRows, "2025-02-01T00:00:00.000Z");
    expect(plan.inserted).toBe(0);
    expect(plan.updated).toBe(0);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates[0].rowNumber).toBe(2);
    expect(plan.updates[0].values[4]).toBe(hash);
    expect(plan.updates[0].values[9]).toBe("2025-01-05T00:00:00.000Z");
    expect(plan.updates[0].values[10]).toBe("2025-02-01T00:00:00.000Z");
  });

  it("detects an edited review by its changed text_hash and keeps first_seen_at", async () => {
    const oldHash = await sha256Hex(normalizeText("Old text"));
    const existingRows = [
      ["r1", "2025-01-01T00:00:00.000Z", "5", "Old text", oldHash, "Test Reviewer", "", "", "https://example.com/review/r1", "2025-01-05T00:00:00.000Z", "2025-01-05T00:00:00.000Z"],
    ];
    const plan = await planUpsert([fakeReview({ text: "New edited text" })], existingRows, "2025-02-01T00:00:00.000Z");
    expect(plan.updated).toBe(1);
    expect(plan.updates[0].values[3]).toBe("New edited text");
    expect(plan.updates[0].values[4]).not.toBe(oldHash);
    expect(plan.updates[0].values[9]).toBe("2025-01-05T00:00:00.000Z");
  });

  it("running the same pull twice adds no new rows", async () => {
    const first = await planUpsert([fakeReview({})], [], "2025-02-01T00:00:00.000Z");
    const asExisting = first.newRows;
    const second = await planUpsert([fakeReview({})], asExisting, "2025-03-01T00:00:00.000Z");
    expect(second.inserted).toBe(0);
    expect(second.newRows).toHaveLength(0);
  });
});
