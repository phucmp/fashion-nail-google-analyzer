import { authCookie, hasAuthCookie, sha256Hex } from "../lib/auth";

interface Env {
  DASHBOARD_PASSWORD: string;
}

function loginPage(error: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fashion Nails & Spa VIP</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..800&display=swap" rel="stylesheet">
<style>
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #2E2050, #4A2E6B); font-family: 'Instrument Sans', sans-serif; padding: 20px; box-sizing: border-box; }
form { background: #fff; border-radius: 22px; padding: 32px 24px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 10px 28px rgba(30,20,50,.3); }
.eyebrow { font-size: 12px; letter-spacing: .12em; color: #6B7280; font-weight: 700; }
h1 { font-size: 22px; margin: 6px 0 4px; color: #1F2230; }
p { color: #5C6170; font-size: 14px; margin: 0 0 20px; }
.err { color: #C43E5C; font-weight: 600; margin: 0 0 12px; }
input { width: 100%; box-sizing: border-box; font-size: 24px; text-align: center; letter-spacing: .2em; padding: 12px; border: 1px solid #D7DAE3; border-radius: 14px; font-family: inherit; }
button { width: 100%; margin-top: 14px; padding: 14px; font-size: 16px; font-weight: 700; color: #fff; background: #4A2E6B; border: none; border-radius: 14px; cursor: pointer; font-family: inherit; }
</style>
</head>
<body>
<form method="POST" action="/login">
  <div class="eyebrow">REVIEW DASHBOARD</div>
  <h1>Fashion Nails &amp; Spa VIP</h1>
  <p>Enter your access code</p>
  ${error ? '<p class="err">That code didn’t work — please try again.</p>' : ""}
  <input name="code" inputmode="numeric" autocomplete="one-time-code" autofocus aria-label="Access code">
  <button>View dashboard</button>
</form>
</body>
</html>`;
  return new Response(html, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname === "/api/ingest") return context.next();
  if (!env.DASHBOARD_PASSWORD) return new Response("Dashboard is not configured", { status: 500 });

  const expected = await sha256Hex(env.DASHBOARD_PASSWORD);
  if (hasAuthCookie(request.headers.get("Cookie"), expected)) return context.next();

  if (request.method === "POST" && url.pathname === "/login") {
    const code = String((await request.formData()).get("code") ?? "").trim();
    if ((await sha256Hex(code)) === expected) {
      return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": authCookie(expected) } });
    }
    return loginPage(true);
  }

  if (url.pathname.startsWith("/api/")) return new Response("Authentication required", { status: 401 });
  return loginPage(false);
};
