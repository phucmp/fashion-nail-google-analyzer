export interface ReviewRow {
  reviewId: string;
  postedAt: string;
  stars: number;
  text: string;
  textHash: string;
  reviewerName: string;
  ownerReply: string;
  ownerReplyAt: string;
  reviewUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface StaffMentionLabel {
  name: string;
  onRoster: boolean;
  polarity: "praised" | "criticized" | "neutral";
  evidence: string;
}

export interface TopicLabel {
  label: string;
  sentiment: "positive" | "negative";
}

export interface LabelRow {
  reviewId: string;
  textHash: string;
  promptVersion: string;
  sentiment: "positive" | "mixed" | "negative";
  topics: TopicLabel[];
  staffMentions: StaffMentionLabel[];
  labeledAt: string;
  model: string;
}

export interface MonthlyTrendPoint {
  month: string;
  count: number;
  avgRating: number | null;
}

export interface SentimentCounts {
  positive: number;
  mixed: number;
  negative: number;
  total: number;
}

export interface StaffMentionCount {
  name: string;
  praised: number;
  criticized: number;
  neutral: number;
}

export interface ThemeCount {
  label: string;
  count: number;
}

export interface Quote {
  reviewId: string;
  reviewerName: string;
  text: string;
  stars: number;
  postedAt: string;
}

export interface Metrics {
  rangeStart: string;
  rangeEnd: string;
  reviewCounts: { allTime: number; period: number; priorPeriod: number; change: number };
  fiveStarShare: { allTime: number; mtEra: number; period: number; priorPeriod: number };
  sinceMt: { avgRating: number | null; count: number; avgRatingBefore: number | null; countBefore: number };
  trend: MonthlyTrendPoint[];
  ownerReplyRate: { allTime: number; mtEra: number; period: number };
  starDistributionPeriod: Record<string, number>;
  sentimentPeriod: SentimentCounts | null;
  staffMentionsPeriod: StaffMentionCount[] | null;
  themesPeriod: { positive: ThemeCount[]; feedback: ThemeCount[] } | null;
  topQuotes: Quote[];
  hasLabels: boolean;
}

export interface MetricsInput {
  reviews: ReviewRow[];
  labels: LabelRow[];
  eraStart: string;
  timezone: string;
  /** Inclusive YYYY-MM bounds of the selected viewing range. */
  rangeStart: string;
  rangeEnd: string;
}

export function monthKey(isoDate: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(new Date(isoDate));
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function latestCompleteMonth(now: Date, timezone: string): string {
  return shiftMonth(monthKey(now.toISOString(), timezone), -1);
}

/** Number of calendar months spanned by [start, end], inclusive. */
export function monthSpan(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

function avgRating(reviews: ReviewRow[]): number | null {
  if (!reviews.length) return null;
  return round(reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length);
}

function fiveStarShare(reviews: ReviewRow[]): number {
  if (!reviews.length) return 0;
  return round((reviews.filter((r) => r.stars === 5).length / reviews.length) * 100);
}

function replyRate(reviews: ReviewRow[]): number {
  if (!reviews.length) return 0;
  return round((reviews.filter((r) => r.ownerReply.trim().length > 0).length / reviews.length) * 100);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMetrics(input: MetricsInput): Metrics {
  const { reviews, labels, eraStart, timezone, rangeStart, rangeEnd } = input;
  const eraStartMonth = eraStart.slice(0, 7);

  const periodLength = monthSpan(rangeStart, rangeEnd);
  const priorEnd = shiftMonth(rangeStart, -1);
  const priorStart = shiftMonth(priorEnd, -(periodLength - 1));

  const withMonth = reviews.map((r) => ({ review: r, month: monthKey(r.postedAt, timezone) }));
  const mtEra = withMonth.filter((r) => r.month >= eraStartMonth).map((r) => r.review);
  const beforeMt = withMonth.filter((r) => r.month < eraStartMonth).map((r) => r.review);
  const periodReviews = withMonth.filter((r) => r.month >= rangeStart && r.month <= rangeEnd).map((r) => r.review);
  const priorPeriodReviews = withMonth
    .filter((r) => r.month >= priorStart && r.month <= priorEnd)
    .map((r) => r.review);

  const trendByMonth = new Map<string, ReviewRow[]>();
  for (const { review, month: m } of withMonth) {
    const list = trendByMonth.get(m) ?? [];
    list.push(review);
    trendByMonth.set(m, list);
  }
  const trend: MonthlyTrendPoint[] = [...trendByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, list]) => ({ month: m, count: list.length, avgRating: avgRating(list) }));

  const labelByReviewId = new Map(labels.map((l) => [l.reviewId, l]));
  const hasLabels = labels.length > 0;

  return {
    rangeStart,
    rangeEnd,
    reviewCounts: {
      allTime: reviews.length,
      period: periodReviews.length,
      priorPeriod: priorPeriodReviews.length,
      change: periodReviews.length - priorPeriodReviews.length,
    },
    fiveStarShare: {
      allTime: fiveStarShare(reviews),
      mtEra: fiveStarShare(mtEra),
      period: fiveStarShare(periodReviews),
      priorPeriod: fiveStarShare(priorPeriodReviews),
    },
    sinceMt: {
      avgRating: avgRating(mtEra),
      count: mtEra.length,
      avgRatingBefore: avgRating(beforeMt),
      countBefore: beforeMt.length,
    },
    trend,
    ownerReplyRate: { allTime: replyRate(reviews), mtEra: replyRate(mtEra), period: replyRate(periodReviews) },
    starDistributionPeriod: starDistribution(periodReviews),
    sentimentPeriod: hasLabels ? aggregateSentiment(periodReviews, labelByReviewId) : null,
    staffMentionsPeriod: hasLabels ? aggregateStaffMentions(periodReviews, labelByReviewId) : null,
    themesPeriod: hasLabels ? aggregateThemes(periodReviews, labelByReviewId) : null,
    topQuotes: pickTopQuotes(periodReviews),
    hasLabels,
  };
}

function starDistribution(reviews: ReviewRow[]): Record<string, number> {
  const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const r of reviews) {
    const key = String(r.stars);
    if (key in dist) dist[key]++;
  }
  return dist;
}

function aggregateSentiment(reviews: ReviewRow[], labelByReviewId: Map<string, LabelRow>): SentimentCounts {
  const counts: SentimentCounts = { positive: 0, mixed: 0, negative: 0, total: 0 };
  for (const r of reviews) {
    const label = labelByReviewId.get(r.reviewId);
    if (!label) continue;
    counts[label.sentiment]++;
    counts.total++;
  }
  return counts;
}

function aggregateStaffMentions(reviews: ReviewRow[], labelByReviewId: Map<string, LabelRow>): StaffMentionCount[] {
  const counts = new Map<string, StaffMentionCount>();
  for (const r of reviews) {
    const label = labelByReviewId.get(r.reviewId);
    if (!label) continue;
    for (const mention of label.staffMentions) {
      if (!mention.onRoster) continue;
      const entry = counts.get(mention.name) ?? { name: mention.name, praised: 0, criticized: 0, neutral: 0 };
      entry[mention.polarity]++;
      counts.set(mention.name, entry);
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.praised + b.criticized + b.neutral - (a.praised + a.criticized + a.neutral),
  );
}

function aggregateThemes(
  reviews: ReviewRow[],
  labelByReviewId: Map<string, LabelRow>,
): { positive: ThemeCount[]; feedback: ThemeCount[] } {
  const positive = new Map<string, number>();
  const feedback = new Map<string, number>();
  for (const r of reviews) {
    const label = labelByReviewId.get(r.reviewId);
    if (!label) continue;
    for (const topic of label.topics) {
      const bucket = topic.sentiment === "positive" ? positive : feedback;
      bucket.set(topic.label, (bucket.get(topic.label) ?? 0) + 1);
    }
  }
  const toSorted = (m: Map<string, number>): ThemeCount[] =>
    [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return { positive: toSorted(positive), feedback: toSorted(feedback) };
}

/** Deterministic, non-AI pick of quotable reviews: 5-star and a substantive length, most recent first. */
function pickTopQuotes(reviews: ReviewRow[], limit = 6): Quote[] {
  const strict = reviews.filter((r) => r.stars === 5 && r.text.trim().length >= 60 && r.text.trim().length <= 400);
  const strictIds = new Set(strict.map((r) => r.reviewId));
  const loose = reviews.filter((r) => r.stars >= 4 && r.text.trim().length >= 40 && !strictIds.has(r.reviewId));
  return [...strict, ...loose]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, limit)
    .map((r) => ({ reviewId: r.reviewId, reviewerName: r.reviewerName, text: r.text.trim(), stars: r.stars, postedAt: r.postedAt }));
}

export type RangePreset = "this-month" | "last-3-months" | "last-6-months" | "ytd" | "last-12-months" | "all-time";

/** Resolves a preset keyword or a specific "YYYY-MM" into inclusive [start, end] month bounds. */
export function resolveRange(rangeParam: string | null, latestMonth: string): { start: string; end: string } {
  switch (rangeParam) {
    case "last-3-months":
      return { start: shiftMonth(latestMonth, -2), end: latestMonth };
    case "last-6-months":
      return { start: shiftMonth(latestMonth, -5), end: latestMonth };
    case "last-12-months":
      return { start: shiftMonth(latestMonth, -11), end: latestMonth };
    case "ytd":
      return { start: `${latestMonth.slice(0, 4)}-01`, end: latestMonth };
    case "all-time":
      // Open-ended on both sides: "all time" must include every review, not just those up to
      // the latest *complete* month (the cutoff used for "this month"-style ranges).
      return { start: "0000-01", end: "9999-12" };
    case "this-month":
    case null:
      return { start: latestMonth, end: latestMonth };
    default:
      if (/^\d{4}-\d{2}$/.test(rangeParam)) return { start: rangeParam, end: rangeParam };
      return { start: latestMonth, end: latestMonth };
  }
}
