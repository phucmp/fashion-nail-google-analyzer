export interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  SHEET_ID: string;
}

let cachedToken: { token: string; exp: number } | null = null;

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBytes(pem: string): Uint8Array {
  const bin = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

/** Service-account JWT -> OAuth access token, cached until shortly before expiry. */
async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const creds = JSON.parse(atob(env.GOOGLE_SERVICE_ACCOUNT_JSON));
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(creds.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: now + data.expires_in };
  return cachedToken.token;
}

async function sheetsFetch(env: Env, path: string, init?: { method: string; body: string }): Promise<any> {
  const token = await getAccessToken(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Sheets API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getSheetRows(env: Env, tab: string): Promise<string[][]> {
  const data = await sheetsFetch(env, `/values/${encodeURIComponent(tab)}`);
  return (data.values as string[][]) ?? [];
}

export async function appendRows(env: Env, tab: string, rows: string[][]): Promise<void> {
  if (!rows.length) return;
  await sheetsFetch(env, `/values/${encodeURIComponent(tab)}:append?valueInputOption=RAW`, {
    method: "POST",
    body: JSON.stringify({ values: rows }),
  });
}

export async function batchUpdateRows(
  env: Env,
  tab: string,
  updates: { rowNumber: number; values: string[] }[],
): Promise<void> {
  if (!updates.length) return;
  await sheetsFetch(env, "/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: updates.map((u) => ({ range: `${tab}!A${u.rowNumber}`, values: [u.values] })),
    }),
  });
}
