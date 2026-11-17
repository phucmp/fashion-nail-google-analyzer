import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  latestCompleteMonth,
  monthKey,
  monthSpan,
  resolveRange,
  shiftMonth,
  type ReviewRow,
} from "./metrics";

const TZ = "America/Los_Angeles";

function fakeReview(overrides: Partial<ReviewRow>): ReviewRow {
  return {
    reviewId: "r1",
    postedAt: "2025-01-15T20:00:00.000Z",
    stars: 5,
    text: "Made-up review text, loved it!",
    textHash: "hash1",
    reviewerName: "Test Reviewer",
    ownerReply: "",
    ownerReplyAt: "",
    reviewUrl: "https://example.com/r1",
    firstSeenAt: "2025-01-16T00:00:00.000Z",
    lastSeenAt: "2025-01-16T00:00:00.000Z",
    ...overrides,
  };
}

function metrics(reviews: ReviewRow[], range: { start: string; end: string }, labels: Parameters<typeof computeMetrics>[0]["labels"] = []) {
  return computeMetrics({
    reviews,
    labels,
    eraStart: "2024-10-01",
    timezone: TZ,
    rangeStart: range.start,
    rangeEnd: range.end,
  });
}

describe("monthKey", () => {
  it("buckets a review by Pacific time, not UTC, across a month boundary", () => {
    // 2025-01-01T07:29:00Z is 2024-12-31 23:29 PST (UTC-8)
    expect(monthKey("2025-01-01T07:29:00.000Z", TZ)).toBe("2024-12");
    // 2025-01-01T08:01:00Z is 2025-01-01 00:01 PST
    expect(monthKey("2025-01-01T08:01:00.000Z", TZ)).toBe("2025-01");
  });
});

describe("shiftMonth / latestCompleteMonth / monthSpan", () => {
  it("shifts across a year boundary", () => {
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
  });

  it("returns the previous calendar month as the latest complete month", () => {
    expect(latestCompleteMonth(new Date("2025-03-15T12:00:00.000Z"), TZ)).toBe("2025-02");
  });

  it("counts months inclusively, across a year boundary", () => {
    expect(monthSpan("2025-01", "2025-01")).toBe(1);
    expect(monthSpan("2024-11", "2025-01")).toBe(3);
  });
});

describe("resolveRange", () => {
  it("resolves presets relative to the latest month", () => {
    expect(resolveRange("this-month", "2026-09")).toEqual({ start: "2026-09", end: "2026-09" });
    expect(resolveRange("last-3-months", "2026-09")).toEqual({ start: "2026-07", end: "2026-09" });
    expect(resolveRange("last-12-months", "2026-09")).toEqual({ start: "2025-10", end: "2026-09" });
    expect(resolveRange("ytd", "2026-09")).toEqual({ start: "2026-01", end: "2026-09" });
    // "all-time" must never exclude reviews posted after the latest *complete* month
    expect(resolveRange("all-time", "2026-09")).toEqual({ start: "0000-01", end: "9999-12" });
  });

  it("treats a YYYY-MM value as a specific single month", () => {
    expect(resolveRange("2025-03", "2026-09")).toEqual({ start: "2025-03", end: "2025-03" });
  });

  it("falls back to this-month for null or garbage input", () => {
    expect(resolveRange(null, "2026-09")).toEqual({ start: "2026-09", end: "2026-09" });
    expect(resolveRange("nonsense", "2026-09")).toEqual({ start: "2026-09", end: "2026-09" });
  });
});

describe("computeMetrics", () => {
  it("splits reviews at ERA_START by month, not by exact day", () => {
    const reviews = [
      fakeReview({ reviewId: "before", postedAt: "2024-09-30T20:00:00.000Z", stars: 3 }),
      fakeReview({ reviewId: "since", postedAt: "2024-10-01T20:00:00.000Z", stars: 5 }),
    ];
    const m = metrics(reviews, { start: "2024-10", end: "2024-10" });
    expect(m.sinceMt.count).toBe(1);
    expect(m.sinceMt.countBefore).toBe(1);
  });

  it("computes the 5-star share correctly", () => {
    const reviews = [
      fakeReview({ reviewId: "a", stars: 5 }),
      fakeReview({ reviewId: "b", stars: 5 }),
      fakeReview({ reviewId: "c", stars: 1 }),
      fakeReview({ reviewId: "d", stars: 3 }),
    ];
    const m = metrics(reviews, { start: "2025-01", end: "2025-01" });
    expect(m.fiveStarShare.allTime).toBe(50);
  });

  it("doesn't crash on reviews with no text, and still counts them", () => {
    const reviews = [fakeReview({ reviewId: "empty", text: "" })];
    const m = metrics(reviews, { start: "2025-01", end: "2025-01" });
    expect(m.reviewCounts.allTime).toBe(1);
  });

  it("uses a review's current fields even if it was edited (text_hash is not used for arithmetic)", () => {
    const edited = fakeReview({ reviewId: "edited", stars: 2, text: "updated text", textHash: "new-hash" });
    const m = metrics([edited], { start: "2025-01", end: "2025-01" });
    expect(m.sinceMt.avgRating).toBe(2);
  });

  it("returns null sentiment/staffMentions when no labels exist yet", () => {
    const m = metrics([fakeReview({})], { start: "2025-01", end: "2025-01" });
    expect(m.sentimentPeriod).toBeNull();
    expect(m.staffMentionsPeriod).toBeNull();
    expect(m.hasLabels).toBe(false);
  });

  it("scopes stars/sentiment to the selected period, separate from all-time", () => {
    const reviews = [
      fakeReview({ reviewId: "jan1", postedAt: "2025-01-10T20:00:00.000Z", stars: 5 }),
      fakeReview({ reviewId: "feb1", postedAt: "2025-02-10T20:00:00.000Z", stars: 1 }),
    ];
    const m = metrics(
      reviews,
      { start: "2025-01", end: "2025-01" },
      [
        {
          reviewId: "jan1",
          textHash: "hash1",
          promptVersion: "v1",
          sentiment: "positive",
          topics: [],
          staffMentions: [],
          labeledAt: "2025-01-16T00:00:00.000Z",
          model: "test",
        },
        {
          reviewId: "feb1",
          textHash: "hash1",
          promptVersion: "v1",
          sentiment: "negative",
          topics: [],
          staffMentions: [],
          labeledAt: "2025-02-16T00:00:00.000Z",
          model: "test",
        },
      ],
    );
    expect(m.reviewCounts.allTime).toBe(2);
    expect(m.starDistributionPeriod).toEqual({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 1 });
    expect(m.sentimentPeriod).toEqual({ positive: 1, mixed: 0, negative: 0, total: 1 });
  });

  it("aggregates sentiment and on-roster staff mentions from labels when present", () => {
    const reviews = [fakeReview({ reviewId: "r1" }), fakeReview({ reviewId: "r2" })];
    const m = metrics(
      reviews,
      { start: "2025-01", end: "2025-01" },
      [
        {
          reviewId: "r1",
          textHash: "hash1",
          promptVersion: "v1",
          sentiment: "positive",
          topics: [],
          staffMentions: [{ name: "MT", onRoster: true, polarity: "praised", evidence: "great" }],
          labeledAt: "2025-01-16T00:00:00.000Z",
          model: "test",
        },
        {
          reviewId: "r2",
          textHash: "hash1",
          promptVersion: "v1",
          sentiment: "negative",
          topics: [],
          staffMentions: [{ name: "Unknown Person", onRoster: false, polarity: "criticized", evidence: "x" }],
          labeledAt: "2025-01-16T00:00:00.000Z",
          model: "test",
        },
      ],
    );
    expect(m.sentimentPeriod).toEqual({ positive: 1, mixed: 0, negative: 1, total: 2 });
    expect(m.staffMentionsPeriod).toEqual([{ name: "MT", praised: 1, criticized: 0, neutral: 0 }]);
  });

  it("includes reviews from the current, still-in-progress month when range is all-time", () => {
    const reviews = [
      fakeReview({ reviewId: "old", postedAt: "2025-01-10T20:00:00.000Z" }),
      fakeReview({ reviewId: "future", postedAt: "2099-01-10T20:00:00.000Z" }),
    ];
    const range = resolveRange("all-time", "2025-01");
    const m = metrics(reviews, range);
    expect(m.reviewCounts.period).toBe(2);
  });

  it("computes priorPeriod over an equal-length window immediately before a multi-month range", () => {
    const reviews = [
      fakeReview({ reviewId: "jun", postedAt: "2025-06-10T20:00:00.000Z" }),
      fakeReview({ reviewId: "jul", postedAt: "2025-07-10T20:00:00.000Z" }),
      fakeReview({ reviewId: "aug", postedAt: "2025-08-10T20:00:00.000Z" }),
      fakeReview({ reviewId: "sep", postedAt: "2025-09-10T20:00:00.000Z" }),
    ];
    // range = last 3 months of (Jul, Aug, Sep); prior period should be the 3 months before that (Apr, May, Jun)
    const m = metrics(reviews, { start: "2025-07", end: "2025-09" });
    expect(m.reviewCounts.period).toBe(3);
    expect(m.reviewCounts.priorPeriod).toBe(1);
  });

  it("computes reply rate scoped to the selected period", () => {
    const reviews = [
      fakeReview({ reviewId: "jan1", postedAt: "2025-01-10T20:00:00.000Z", ownerReply: "Thanks!" }),
      fakeReview({ reviewId: "jan2", postedAt: "2025-01-11T20:00:00.000Z", ownerReply: "" }),
      fakeReview({ reviewId: "feb1", postedAt: "2025-02-10T20:00:00.000Z", ownerReply: "Thanks!" }),
    ];
    const m = metrics(reviews, { start: "2025-01", end: "2025-01" });
    expect(m.ownerReplyRate.period).toBe(50);
  });

  it("aggregates themes by sentiment and ranks by count", () => {
    const reviews = [
      fakeReview({ reviewId: "r1" }),
      fakeReview({ reviewId: "r2" }),
      fakeReview({ reviewId: "r3" }),
    ];
    const labelWith = (reviewId: string, topics: { label: string; sentiment: "positive" | "negative" }[]) => ({
      reviewId,
      textHash: "hash1",
      promptVersion: "v2",
      sentiment: "positive" as const,
      topics,
      staffMentions: [],
      labeledAt: "2025-01-16T00:00:00.000Z",
      model: "test",
    });
    const m = metrics(reviews, { start: "2025-01", end: "2025-01" }, [
      labelWith("r1", [{ label: "Friendly, welcoming staff", sentiment: "positive" }]),
      labelWith("r2", [{ label: "Friendly, welcoming staff", sentiment: "positive" }, { label: "Long wait times", sentiment: "negative" }]),
      labelWith("r3", [{ label: "Long wait times", sentiment: "negative" }]),
    ]);
    expect(m.themesPeriod).toEqual({
      positive: [{ label: "Friendly, welcoming staff", count: 2 }],
      feedback: [{ label: "Long wait times", count: 2 }],
    });
  });

  it("picks quotable reviews: 5-star, substantive length, most recent first", () => {
    const reviews = [
      fakeReview({ reviewId: "short", postedAt: "2025-01-20T00:00:00.000Z", stars: 5, text: "Great!" }),
      fakeReview({
        reviewId: "good1",
        postedAt: "2025-01-10T00:00:00.000Z",
        stars: 5,
        text: "I absolutely loved my experience here, the staff were wonderful and my nails turned out perfect every single time I visit.",
      }),
      fakeReview({
        reviewId: "good2",
        postedAt: "2025-01-15T00:00:00.000Z",
        stars: 5,
        text: "Such a relaxing atmosphere and the nail art was exactly what I asked for, highly recommend this place to everyone I know.",
      }),
      fakeReview({ reviewId: "lowstar", postedAt: "2025-01-18T00:00:00.000Z", stars: 2, text: "It was fine I guess, nothing special about the service at all honestly." }),
    ];
    const m = metrics(reviews, { start: "2025-01", end: "2025-01" });
    expect(m.topQuotes.map((q) => q.reviewId)).toEqual(["good2", "good1"]);
  });

  it("computes five-star share for the prior period alongside the current one", () => {
    const reviews = [
      fakeReview({ reviewId: "p1", postedAt: "2025-02-10T20:00:00.000Z", stars: 5 }),
      fakeReview({ reviewId: "p2", postedAt: "2025-02-11T20:00:00.000Z", stars: 1 }),
      fakeReview({ reviewId: "cur1", postedAt: "2025-03-10T20:00:00.000Z", stars: 5 }),
      fakeReview({ reviewId: "cur2", postedAt: "2025-03-11T20:00:00.000Z", stars: 5 }),
    ];
    const m = metrics(reviews, { start: "2025-03", end: "2025-03" });
    expect(m.fiveStarShare.period).toBe(100);
    expect(m.fiveStarShare.priorPeriod).toBe(50);
  });
});
