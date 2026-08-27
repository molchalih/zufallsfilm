import { copyFor } from "./copy";

// A request that asks for HTML and does not match a route never reaches the
// bundle, so this document carries its own styles inline and runs no script.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

export function errorPage(status: number, reason?: string): string {
  const { code, headline } = copyFor(status, reason);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(code)} · zufallsfilm</title>
<style>
html,body{margin:0;padding:0;background:#f2f1ec;}
*{box-sizing:border-box;}
a{color:#141414;text-decoration:underline;text-underline-offset:3px;}
a:hover{color:#e0201b;}
::selection{background:#141414;color:#f2f1ec;}
.wrap{min-height:100vh;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f2f1ec;color:#141414;display:flex;flex-direction:column;}
.head{display:flex;align-items:baseline;gap:12px;padding:18px 40px;}
.mark{width:11px;height:11px;background:#e0201b;display:inline-block;transform:translateY(1px);}
.foot{padding:0 40px 32px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.code{font-size:44px;font-weight:700;letter-spacing:-0.03em;line-height:1;}
.headline{font-size:15px;color:#55534c;}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <a href="/" style="display:inline-flex;align-items:baseline;gap:12px;text-decoration:none;">
      <span class="mark"></span>
      <span style="font-size:15px;font-weight:700;color:#141414;">zufallsfilm</span>
    </a>
  </header>
  <div style="flex:1;"></div>
  <div class="foot">
    <div style="display:flex;flex-direction:column;gap:8px;">
      <span class="code">${esc(code)}</span>
      <span class="headline">${esc(headline)}</span>
    </div>
    <a href="/" style="font-size:14px;color:#141414;font-weight:700;">pick a film instead &rarr;</a>
  </div>
</div>
</body>
</html>
`;
}
