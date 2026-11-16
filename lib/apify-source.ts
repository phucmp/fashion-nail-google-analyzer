import type { RawReview, ReviewSource } from "./review-source";

const API_BASE = "https://api.apify.com/v2";
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

export interface ApifySourceConfig {
  apifyToken: string;
  actorId: string;
  placeUrl: string;
}

interface ApifyReviewItem {
  reviewId: string;
  publishedAtDate: string;
  stars: number;
  text: string | null;
  name: string | null;
  responseFromOwnerText: string | null;
  responseFromOwnerDate: string | null;
  reviewUrl: string | null;
}

export class ApifySource implements ReviewSource {
  constructor(private readonly config: ApifySourceConfig) {}

  async fetchAllReviews(): Promise<RawReview[]> {
    const runId = await this.startRun();
    const datasetId = await this.waitForRun(runId);
    const items = await this.fetchDatasetItems(datasetId);
    return items.map(toRawReview);
  }

  private async startRun(): Promise<string> {
    const actorPath = this.config.actorId.replace("/", "~");
    const res = await fetch(`${API_BASE}/acts/${actorPath}/runs?token=${this.config.apifyToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: this.config.placeUrl }],
        reviewsSort: "newest",
        language: "en",
        personalData: true,
      }),
    });
    if (!res.ok) throw new Error(`Apify run start failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { data: { id: string } };
    return data.data.id;
  }

  private async waitForRun(runId: string, timeoutMs = 10 * 60 * 1000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${API_BASE}/actor-runs/${runId}?token=${this.config.apifyToken}`);
      if (!res.ok) throw new Error(`Apify run status check failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { data: { status: string; defaultDatasetId: string } };
      const status = data.data.status;
      if (status === "SUCCEEDED") return data.data.defaultDatasetId;
      if (TERMINAL_STATUSES.has(status)) throw new Error(`Apify run ended with status ${status}`);
      await sleep(5000);
    }
    throw new Error("Apify run timed out waiting for completion");
  }

  private async fetchDatasetItems(datasetId: string): Promise<ApifyReviewItem[]> {
    const items: ApifyReviewItem[] = [];
    const limit = 1000;
    let offset = 0;
    while (true) {
      const res = await fetch(
        `${API_BASE}/datasets/${datasetId}/items?token=${this.config.apifyToken}&format=json&offset=${offset}&limit=${limit}`,
      );
      if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status} ${await res.text()}`);
      const page = (await res.json()) as ApifyReviewItem[];
      items.push(...page);
      if (page.length < limit) break;
      offset += limit;
    }
    return items;
  }
}

function toRawReview(item: ApifyReviewItem): RawReview {
  return {
    reviewId: item.reviewId,
    postedAt: item.publishedAtDate,
    stars: item.stars,
    text: item.text ?? null,
    reviewerName: item.name ?? null,
    ownerReplyText: item.responseFromOwnerText ?? null,
    ownerReplyAt: item.responseFromOwnerDate ?? null,
    reviewUrl: item.reviewUrl ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
