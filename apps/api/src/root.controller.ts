import { Controller, Get, Header } from "@nestjs/common";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ordr.ae API</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
  main { padding: 2rem 2.5rem; max-width: 32rem; }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; letter-spacing: -.02em; }
  h1 span { color: #22c55e; }
  p { margin: .5rem 0; color: #94a3b8; }
  a { color: #86efac; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
<main>
  <h1>ordr<span>.ae</span> API</h1>
  <p>WhatsApp ordering for UAE businesses. This host serves the messaging API.</p>
  <ul>
    <li><a href="/health">/health</a> service status</li>
    <li><code>/webhooks/whatsapp</code> Meta Cloud API webhook</li>
    <li><code>/merchant/*</code> dashboard API (sign in required)</li>
  </ul>
</main>
</body>
</html>
`;

@Controller()
export class RootController {
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  index(): string {
    return PAGE;
  }
}
