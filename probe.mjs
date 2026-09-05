import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await b.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  locale: "he-IL", viewport: { width: 1400, height: 900 },
});
const p = await ctx.newPage();
const json = [];
p.on("response", r => { const ct = r.headers()["content-type"] ?? ""; if (ct.includes("json")) json.push(`${r.status()} ${r.url().slice(0,160)}`); });
await p.goto("https://main.knesset.gov.il/apps/committees/2216", { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
await p.waitForTimeout(8000);
console.log("title:", JSON.stringify(await p.title()));
console.log("body chars:", (await p.locator("body").innerText().catch(() => "")).length);
console.log("json responses:", json.length ? json.join("\n  ") : "(none)");
await b.close();
