import type { LabelRow, ReviewRow, StaffMentionLabel } from "./metrics";

export function parseReviewRows(rows: string[][]): ReviewRow[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      reviewId: r[0] ?? "",
      postedAt: r[1] ?? "",
      stars: Number(r[2] ?? 0),
      text: r[3] ?? "",
      textHash: r[4] ?? "",
      reviewerName: r[5] ?? "",
      ownerReply: r[6] ?? "",
      ownerReplyAt: r[7] ?? "",
      reviewUrl: r[8] ?? "",
      firstSeenAt: r[9] ?? "",
      lastSeenAt: r[10] ?? "",
    }));
}

export function parseLabelRows(rows: string[][]): LabelRow[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      reviewId: r[0] ?? "",
      textHash: r[1] ?? "",
      promptVersion: r[2] ?? "",
      sentiment: (r[3] as LabelRow["sentiment"]) ?? "neutral",
      topics: parseJsonArray(r[4]),
      staffMentions: parseJsonArray(r[5]) as StaffMentionLabel[],
      labeledAt: r[6] ?? "",
      model: r[7] ?? "",
    }));
}

export interface RosterEntry {
  name: string;
  aliases: string[];
  active: boolean;
}

export function parseRosterRows(rows: string[][]): RosterEntry[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      name: r[0] ?? "",
      aliases: (r[1] ?? "").split(",").map((a) => a.trim()).filter(Boolean),
      active: (r[2] ?? "true").toLowerCase() !== "false",
    }));
}

export interface MonthlyAnalysisRow {
  month: string;
  insights: { title: string; body: string; citedReviewIds: string[] }[];
  recommendations: { title: string; body: string; citedReviewIds: string[] }[];
  runAt: string;
}

export function parseMonthlyAnalysisRows(rows: string[][]): MonthlyAnalysisRow[] {
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      month: r[0] ?? "",
      insights: parseJsonArray(r[2]),
      recommendations: parseJsonArray(r[3]),
      runAt: r[7] ?? "",
    }));
}

/** Picks the most recently-run analysis row for a given month (reruns append, never overwrite). */
export function latestAnalysisForMonth(rows: MonthlyAnalysisRow[], month: string): MonthlyAnalysisRow | null {
  const matches = rows.filter((r) => r.month === month);
  if (!matches.length) return null;
  return matches.reduce((latest, r) => (r.runAt > latest.runAt ? r : latest));
}

/** The latest analysis row for each month that falls in [start, end], newest month first. */
export function latestAnalysesInRange(rows: MonthlyAnalysisRow[], start: string, end: string): MonthlyAnalysisRow[] {
  const months = [...new Set(rows.filter((r) => r.month >= start && r.month <= end).map((r) => r.month))]
    .sort()
    .reverse();
  return months
    .map((m) => latestAnalysisForMonth(rows, m))
    .filter((r): r is MonthlyAnalysisRow => r !== null);
}

function parseJsonArray(value: string | undefined): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
