import { google } from "googleapis";

export interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  SHEET_ID: string;
}

function getAuth(env: Env) {
  const credentials = JSON.parse(atob(env.GOOGLE_SERVICE_ACCOUNT_JSON));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient(env: Env) {
  return google.sheets({ version: "v4", auth: getAuth(env) });
}

export async function getSheetRows(env: Env, tab: string): Promise<string[][]> {
  const sheets = await getSheetsClient(env);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.SHEET_ID,
    range: tab,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function appendRows(env: Env, tab: string, rows: string[][]): Promise<void> {
  if (!rows.length) return;
  const sheets = await getSheetsClient(env);
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.SHEET_ID,
    range: tab,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function batchUpdateRows(
  env: Env,
  tab: string,
  updates: { rowNumber: number; values: string[] }[],
): Promise<void> {
  if (!updates.length) return;
  const sheets = await getSheetsClient(env);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({ range: `${tab}!A${u.rowNumber}`, values: [u.values] })),
    },
  });
}
