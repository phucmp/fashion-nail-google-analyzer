import { getSheetRows, type Env } from "../../lib/sheets";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const rows = await getSheetRows(context.env, "roster");
    return Response.json({ ok: true, roster_rows: rows.length, roster: rows });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
