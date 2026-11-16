import "./_env";
import { ApifySource } from "../lib/apify-source";
import { upsertReviews } from "../lib/reviews-store";

const REQUIRED = [
  "APIFY_TOKEN",
  "APIFY_ACTOR_ID",
  "PLACE_URL",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_ID",
] as const;

for (const key of REQUIRED) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .dev.vars`);
}

const env = {
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
  SHEET_ID: process.env.SHEET_ID!,
};

const source = new ApifySource({
  apifyToken: process.env.APIFY_TOKEN!,
  actorId: process.env.APIFY_ACTOR_ID!,
  placeUrl: process.env.PLACE_URL!,
});

console.log("Starting Apify run and waiting for it to finish...");
const reviews = await source.fetchAllReviews();
console.log(`Fetched ${reviews.length} reviews from Apify.`);

const now = new Date().toISOString();
const result = await upsertReviews(env, reviews, now);
console.log(`Inserted ${result.inserted}, updated ${result.updated}, unchanged ${result.unchanged}.`);
