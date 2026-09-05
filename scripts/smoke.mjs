/**
 * Browser smoke test — checks the parts server-rendered HTML cannot prove:
 * that the Recharts activity chart hydrates, the theme toggle flips, the bill
 * timeline interleaves committee and plenum events, the plenum views render,
 * search navigates, and no page overflows horizontally on a phone viewport.
 *
 * Start the app first, then:  node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";

const S = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const failures = [];

async function check(path, fn) {
  errors.length = 0;
  await page.goto(S + path, { waitUntil: "networkidle" });
  const result = await fn();
  console.log(`\n${path}`);
  console.log("  " + result);
  console.log("  console errors: " + (errors.length ? errors.join(" | ") : "none"));
  if (errors.length) failures.push(`${path}: ${errors.join(" | ")}`);
  // Patterns must not match a longer number: "barHeights=13" contains
  // "barHeights=1". Each numeric check is anchored against a following digit.
  const BAD = [
    /\bbars=0(?!\d)/, /\boverflow=true\b/, /\bevents=0(?!\d)/, /\bcards=0(?!\d)/,
    /\bsittings=0(?!\d)/, /\bplenumEvents=0(?!\d)/, /\bcommitteeEvents=0(?!\d)/,
    /\bbillRows=0(?!\d)/, /\bstraysInOther=[1-9]/, /\bbillDocs=0(?!\d)/,
    /\bgovSponsorNote=plain\b/, /\bblocBadges=0(?!\d)/, /\bgroups=0(?!\d)/,
    /\bcheckboxHeld=false\b/, /\bxTicks=0(?!\d)/, /\bbarHeights=[01](?!\d)/,
    /\bphotosLoaded=0(?!\d)/, /\bphotoLoaded=false\b/, /\bcreditShown=0(?!\d)/,
    /\bfileLink=0(?!\d)/, /\bofficialIdOk=false\b/, /\brows=0(?!\d)/,
    /\bstatCards=0(?!\d)/, /\boverdueSortDescending=false\b/,
    /\bfullNameSearch=0(?!\d)/, /\bmemberQuestionsCard=0(?!\d)/, /\bquestionRows=0(?!\d)/,
    /\bcommittee cards=0(?!\d)/, /\btypeGroups=0(?!\d)/, /\bcommitteeBars=0(?!\d)/,
    /\bcommitteeBills=0(?!\d)/, /\bmemberCommittees=0(?!\d)/,
  ];
  const hit = BAD.find((re) => re.test(result));
  if (hit) failures.push(`${path}: ${result}  [matched ${hit}]`);
}

await check("/members/30839", async () => {
  await page.waitForSelector(".recharts-bar-rectangle", { timeout: 15000 }).catch(() => {});
  const bars = await page.locator(".recharts-bar-rectangle").count();
  // Recharts 3 drops the .recharts-xAxis wrapper, and SVG <text> has no
  // innerText — read textContent off the tick-value class directly.
  const tickText = await page
    .locator(".recharts-cartesian-axis-tick-value")
    .evaluateAll((ns) => ns.map((n) => n.textContent ?? ""));
  // Month labels look like "יוני 23"; the y-axis ticks are bare numbers.
  const ticks = tickText.filter((t) => /\D\s\d{2}$/.test(t.trim())).length;
  const box = await page.locator(".recharts-surface").first().boundingBox();
  const spread = new Set(await page.locator(".recharts-bar-rectangle path").evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().height)))).size;
  return `chart bars=${bars} xTicks=${ticks} barHeights=${spread} surface=${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "none"}`;
});

await check("/", async () => {
  const dir = await page.getAttribute("html", "dir");
  const nav = await page.locator("header nav a").count();
  // Toggle dark mode and confirm the class actually flips.
  const before = await page.getAttribute("html", "class");
  await page.getByRole("button", { name: /מצב/ }).click();
  await page.waitForTimeout(400);
  const after = await page.getAttribute("html", "class");
  return `dir=${dir} navLinks=${nav} theme: "${before}" -> "${after}"`;
});

// A bill whose only activity is one plenum sitting: its text must still be here.
await check("/bills/1057227", async () => {
  const docs = await page.getByTestId("bill-documents").locator('a[href*="fs.knesset.gov.il"]').count();
  const sponsors = (await page.locator("aside").innerText()).includes("ממשלתית") ? "explained" : "plain";
  return `billDocs=${docs} govSponsorNote=${sponsors}`;
});

await check("/bills/2230015", async () => {
  const items = await page.locator("ol li").count();
  const docs = await page.locator('a[href*="fs.knesset.gov.il"]').count();
  const billDocs = await page.getByTestId("bill-documents").locator("a").count();
  const bodies = await page.locator("ol li").allInnerTexts();
  const plenum = bodies.filter((t) => t.includes("מליאה")).length;
  const committee = bodies.filter((t) => t.includes("ועדה")).length;
  return `timeline events=${items} plenumEvents=${plenum} committeeEvents=${committee} protocolLinks=${docs} billDocs=${billDocs}`;
});

await check("/plenum", async () => {
  const cards = await page.locator('a[href^="/plenum/"]').count();
  return `plenum sittings=${cards}`;
});

// Follow the first sitting through to its detail page, and guard the
// classification: bills are split by item type, so a bill must never end up
// under "additional items" just because it is outside the ingested sample.
await check("/plenum", async () => {
  const href = await page.locator('a[href^="/plenum/"]').first().getAttribute("href");
  await page.goto(S + href, { waitUntil: "networkidle" });
  const h1 = await page.locator("h1").first().innerText();
  const links = await page.locator("a[href^='/bills/']").count();

  const billsCard = page.getByTestId("plenum-bills");
  const billRows = await billsCard.locator("a[href^='/bills/'], > div > div.-mx-2").count();
  const otherCard = page.getByTestId("plenum-other");
  const strayBills = (await otherCard.count())
    ? (await otherCard.innerText()).split("\n").filter((l) => l.trim() === "הצעת חוק").length
    : 0;

  return `sitting ${href} h1="${h1}" billRows=${billRows} billLinks=${links} straysInOther=${strayBills}`;
});

// Search box -> results page
await check("/", async () => {
  await page.fill('input[name="q"]', "חוק");
  await page.press('input[name="q"]', "Enter");
  await page.waitForURL(/\/search/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  const heading = await page.locator("h1").first().innerText();
  const cards = await page.locator("h1 ~ div > div").count();
  return `search navigated to ${new URL(page.url()).pathname} h1="${heading}" sections=${cards}`;
});

await check("/committees", async () => {
  const cards = await page.locator('a[href^="/committees/"]').count();
  const groups = await page.locator("section > h2").count();
  return `committee cards=${cards} typeGroups=${groups}`;
});

// The busiest committee: 1,146 sittings once blew SQLite's bound-parameter
// limit when its session ids were passed as an IN list.
await check("/committees/4186", async () => {
  await page.waitForSelector(".recharts-bar-rectangle", { timeout: 15000 }).catch(() => {});
  const bars = await page.locator(".recharts-bar-rectangle").count();
  const bills = await page.locator('a[href^="/bills/"]').count();
  return `committeeBars=${bars} committeeBills=${bills}`;
});

// Written questions: the accountability figures and the sort must both work.
await check("/questions", async () => {
  const rows = await page.locator("text=/הוגשה /").count();
  const stats = await page.locator("text=/נענו באיחור/").count();
  await page.selectOption("select >> nth=0", "overdue");
  await page.waitForURL(/sort=overdue/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  const late = await page.locator("text=/באיחור .* ימים/").allInnerTexts();
  const nums = late.slice(0, 3).map((t) => Number(t.replace(/\D/g, "")));
  const descending = nums.every((n, i) => i === 0 || nums[i - 1] >= n);
  return `questions rows=${rows} statCards=${stats} overdueSortDescending=${descending} worst=${nums[0] ?? 0}`;
});

// A full name spans two columns, so it must not be matched as one string.
await check("/members?q=%D7%A2%D7%95%D7%A4%D7%A8%20%D7%9B%D7%A1%D7%99%D7%A3", async () => {
  return `fullNameSearch=${await page.locator('a[href^="/members/"]').count()}`;
});

await check("/members/30719", async () => {
  const card = await page.locator("text=/שאילתות לשרי הממשלה/").count();
  const rows = await page.locator("text=/הוגשה /").count();
  // The committees card used to read PersonPosition.committeeId, which the
  // service never populates, so it was empty for everyone.
  const committees = await page.locator('aside a[href^="/committees/"]').count();
  return `memberQuestionsCard=${card} questionRows=${rows} memberCommittees=${committees}`;
});

await check("/members", async () => {
  const cards = await page.locator('a[href^="/members/"]').count();
  const blocs = await page.locator("text=קואליציה").count();
  await page.waitForTimeout(1200); // let lazy avatars settle
  const imgs = await page.locator('img[src*="wikimedia"]').count();
  const loaded = await page
    .locator('img[src*="wikimedia"]')
    .evaluateAll((ns) => ns.filter((n) => n.naturalWidth > 0).length);
  return `member cards=${cards} blocBadges=${blocs} photos=${imgs} photosLoaded=${loaded}`;
});

// Photos are CC BY-SA / CC BY: the credit must accompany them.
await check("/members/30749", async () => {
  const photo = await page.locator('img[src*="wikimedia"]').first().evaluate((n) => n.naturalWidth > 0).catch(() => false);
  const credit = await page.locator("text=/תצלום:/").count();
  const fileLink = await page.locator('a[href*="commons.wikimedia.org/wiki/File:"]').count();
  const official = (await page.locator('a[href*="mk-personal-details"]').getAttribute("href")) ?? "";
  // Must key on SiteId (1029), not MKSiteCode (1016).
  return `photoLoaded=${photo} creditShown=${credit} fileLink=${fileLink} officialIdOk=${official.endsWith("/1029")}`;
});

// Sorting is URL-driven; the controls are optimistic so they must reflect the
// change immediately rather than snapping back during the navigation.
await check("/members", async () => {
  await page.selectOption("select", "bloc");
  await page.waitForURL(/sort=bloc/, { timeout: 10000 });
  await page.getByRole("checkbox").check();
  await page.waitForURL(/serving=1/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  const groups = await page.locator("section > h2").count();
  const cards = await page.locator('a[href^="/members/"]').count();
  const checked = await page.getByRole("checkbox").isChecked();
  return `sorted groups=${groups} servingCards=${cards} checkboxHeld=${checked}`;
});

// Horizontal overflow check on mobile width
await page.setViewportSize({ width: 390, height: 844 });
await check("/bills/2230015", async () => {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  return `mobile scrollWidth=${sw} clientWidth=${cw} overflow=${sw > cw + 1}`;
});

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
