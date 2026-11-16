const COOKIE = "dash_auth";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasAuthCookie(cookieHeader: string | null, expectedHash: string): boolean {
  return (cookieHeader ?? "").split(/;\s*/).includes(`${COOKIE}=${expectedHash}`);
}

export function authCookie(expectedHash: string): string {
  // 90 days; rotating DASHBOARD_PASSWORD changes the hash and invalidates every cookie at once
  return `${COOKIE}=${expectedHash}; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
