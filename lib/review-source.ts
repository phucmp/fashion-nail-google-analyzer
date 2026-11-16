export interface RawReview {
  reviewId: string;
  postedAt: string;
  stars: number;
  text: string | null;
  reviewerName: string | null;
  ownerReplyText: string | null;
  ownerReplyAt: string | null;
  reviewUrl: string | null;
}

export interface ReviewSource {
  fetchAllReviews(): Promise<RawReview[]>;
}
