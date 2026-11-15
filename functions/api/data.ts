import { getSheetRows, type Env as SheetsEnv } from "../../lib/sheets";
import {
  latestAnalysesInRange,
  parseLabelRows,
  parseMonthlyAnalysisRows,
  parseReviewRows,
} from "../../lib/sheet-parse";
import { computeMetrics, latestCompleteMonth, resolveRange } from "../../lib/metrics";

interface Env extends SheetsEnv {
  ERA_START: string;
  TIMEZONE: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const rangeParam = url.searchParams.get("range");
  const timezone = context.env.TIMEZONE;

  const [reviewRows, labelRows, analysisRows] = await Promise.all([
    getSheetRows(context.env, "reviews"),
    getSheetRows(context.env, "labels"),
    getSheetRows(context.env, "monthly_analysis"),
  ]);

  const reviews = parseReviewRows(reviewRows.slice(1));
  const labels = parseLabelRows(labelRows.slice(1));
  const analysisAll = parseMonthlyAnalysisRows(analysisRows.slice(1));
  const labelByReviewId = new Map(labels.map((l) => [l.reviewId, l]));

  const latestMonth = latestCompleteMonth(new Date(), timezone);
  const { start: rangeStart, end: rangeEnd } = resolveRange(rangeParam, latestMonth);
  const metrics = computeMetrics({ reviews, labels, eraStart: context.env.ERA_START, timezone, rangeStart, rangeEnd });
  const analyses = latestAnalysesInRange(analysisAll, rangeStart, rangeEnd);
  const availableMonths = [...new Set(metrics.trend.map((t) => t.month))].sort();

  return Response.json({
    range: rangeParam ?? "this-month",
    rangeStart,
    rangeEnd,
    eraStart: context.env.ERA_START,
    availableMonths,
    metrics,
    insights: analyses.length ? analyses.flatMap((a) => a.insights.map((i) => ({ ...i, month: a.month }))) : null,
    recommendations: analyses.length
      ? analyses.flatMap((a) => a.recommendations.map((r) => ({ ...r, month: a.month })))
      : null,
    reviews: reviews
      .map((r) => ({
        reviewId: r.reviewId,
        postedAt: r.postedAt,
        stars: r.stars,
        text: r.text,
        reviewerName: r.reviewerName,
        reviewUrl: r.reviewUrl,
        sentiment: labelByReviewId.get(r.reviewId)?.sentiment ?? null,
      }))
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt)),
  });
};
