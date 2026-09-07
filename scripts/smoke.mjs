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
    /\bcommittee cards=0(?!\d)/, /\bmembershipRows=0(?!\d)/, /\bcaveatShown=false\b/,
    /\bcapped=false\b/, /\bchairCounts=false\b/, /\btypeGroups=0(?!\d)/, /\bcommitteeBars=0(?!\d)/,
    /\bcommitteeBills=0(?!\d)/, /\bmemberCommittees=0(?!\d)/,
    /\bvoteRows=0(?!\d)/, /\btallied=0(?!\d)/, /\bvoterNames=0(?!\d)/,
    /\bidFallbacks=[1-9]/, /\bgroups=0(?!\d)/, /\bmemberLinks=0(?!\d)/,
    /\bsittingLink=0(?!\d)/, /\bsittingVotes=0(?!\d)/, /\bmemberVoteCard=0(?!\d)/,
    /\bbillVotes=0(?!\d)/, /\bbillLinkOnVote=0(?!\d)/, /\bseparateSection=[1-9]/,
    /\bleadBadges=[1-9]/, /\bsponsors=0(?!\d)/, /\brosterMembers=0(?!\d)/,
    /\bsummaryExplained=false\b/, /\benactedText=0(?!\d)/,
    /\bdefeatRows=0(?!\d)/, /\bcloseRows=0(?!\d)/, /\bsponsorRows=0(?!\d)/,
    /\bkillerAsymmetry=false\b/, /\bownBlocNote=0(?!\d)/,
    /\bfunnelLines=0(?!\d)/, /\bfunnelMonotonic=false\b/, /\bfunnelStages=[0-6](?!\d)/,
    /\bscrollKept=false\b/, /\bcountLines=[0-7](?!\d)/, /\bblocGap=[0-9](?!\d)/,
    /\byTicks=[0-5](?!\d)/, /\blowTicks=[01](?!\d)/,
    /\bblocLines=[01](?!\d)/, /\bfactionLines=[0-1](?!\d)/, /\blegendTooLong=true\b/,
    /\brosterChair=0(?!\d)/, /\bblocSplit=false\b/, /\bmemberSeats=0(?!\d)/,
    /\battendanceDisclosed=false\b/, /\brosterPast=0(?!\d)/, /\brosterDupes=[1-9]/,
    /\bseatDupes=[1-9]/,
    /\bmoreLink=0(?!\d)/, /\binterleaved=false\b/,
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

// The official roster and the attendance list must both be present and clearly
// separate: the appointed composition is a third the size of the set of people
// who have attended, and conflating them was a claim this project already got
// wrong once. 4186 is ועדת הכספים.
await check("/committees/4186", async () => {
  const chair = await page.locator('[data-testid="committee-roster"]').getByText("יושב/ת ראש").count();
  // Serving seats only — past ones sit inside a collapsed <details>.
  const all = await page.locator('[data-testid="committee-roster"] a[href^="/members/"]').count();
  const past = await page.locator('[data-testid="committee-roster"] details a[href^="/members/"]').count();
  const text = await page.locator('[data-testid="committee-roster"]').innerText();
  const blocSplit = /מהקואליציה/.test(text) && /מהאופוזיציה/.test(text);
  // The attendance card must say how many people it is not showing, or the two
  // lists look the same size when one is three times the other.
  const att = await page.locator('[data-testid="committee-attendance"]').innerText();
  const disclosed = /עוד \d+ נכחו/.test(att) || !/מוצגים/.test(att);
  // A chair holds a member seat too, so nobody may appear in two groups.
  // Serving groups only: the collapsed past list repeats people legitimately,
  // since one person can have held several seats over the term.
  const hrefs = await page
    .locator('[data-testid="committee-roster"] a[href^="/members/"]:not(details a)')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute("href")));
  const dupes = hrefs.length - new Set(hrefs).size;
  return `rosterChair=${chair} rosterMembers=${all - past} rosterPast=${past} blocSplit=${blocSplit} attendanceDisclosed=${disclosed} rosterDupes=${dupes}`;
});

await check("/members/30719", async () => {
  const seats = await page.locator('[data-testid="member-seats"] li').count();
  // The same committee must not be listed twice for one member.
  const names = await page
    .locator('[data-testid="member-seats"] li a[href^="/committees/"]')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute("href")));
  return `memberSeats=${seats} seatDupes=${names.length - new Set(names).size}`;
});

// The feed marks 98% of sponsors as `IsInitiator`, so no page may present a
// lead sponsor. 2229019 is a government bill that inherited 11 cross-party
// sponsors from a private bill merged into it — every one of them used to be
// badged as the lead.
await check("/bills/2229019", async () => {
  const sponsors = await page.locator('aside a[href^="/members/"]').count();
  const leadBadges = (await page.locator("aside").innerText()).split("יוזם/ת ראשי/ת").length - 1;
  return `sponsors=${sponsors} leadBadges=${leadBadges}`;
});

await check("/members/30719", async () => {
  const leadBadges = (await page.locator("body").innerText()).split("יוזם/ת ראשי/ת").length - 1;
  return `member leadBadges=${leadBadges}`;
});

// The bill funnel must fall monotonically: it counts bills that got AT LEAST
// as far as each stage, so a rise means the rung mapping broke. Government
// bills used to produce exactly that, rising 60 -> 410 -> 578.
await check("/patterns", async () => {
  await page.waitForSelector(".recharts-line", { timeout: 15000 }).catch(() => {});
  const lines = await page.locator(".recharts-line").count();
  // Recharts 3 has no .recharts-xAxis wrapper, so both axes share the tick
  // class; the y ticks are bare numbers and the stage labels are not.
  const stages = await page
    .locator(".recharts-cartesian-axis-tick-value")
    .evaluateAll((ns) => ns.map((n) => (n.textContent || "").trim()).filter((t) => t && !/^[\d,.%]+$/.test(t)).length);
  const ys = await page
    .locator(".recharts-line-dots circle")
    .evaluateAll((ns) => ns.map((n) => Number(n.getAttribute("cy"))));
  // A falling series plots downward, so cy must be non-decreasing.
  const monotonic = ys.every((y, i) => i === 0 || y >= ys[i - 1] - 0.5);
  return `funnelLines=${lines} funnelStages=${stages} funnelMonotonic=${monotonic}`;
});

await check("/patterns?funnel=bloc", async () => {
  await page.waitForSelector(".recharts-line", { timeout: 15000 }).catch(() => {});
  const lines = await page.locator(".recharts-line").count();

  // Switching view must not throw the reader back to the top — the controls sit
  // above the chart, so a scroll reset hides what they just asked to see.
  //
  // Dispatch the click through the DOM rather than page.click(): Playwright
  // scrolls an element into view before clicking it, which moves the window
  // itself and makes the measurement meaningless. That artifact read as a bug
  // in three separate runs before this was written down.
  await page.evaluate(() => window.scrollTo(0, 350));
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => (x.textContent || "").trim() === "לפי סיעה");
    a?.click();
  });
  await page.waitForURL(/funnel=faction/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  const after = await page.evaluate(() => window.scrollY);
  return `blocLines=${lines} scrollKept=${before > 100 && Math.abs(after - before) < 40}`;
});

// The party view in counts must draw every line. On a log axis it drew none:
// רע"ם reaches the last two rungs 0 times, log cannot plot 0, and Recharts
// dropped the whole view rather than the one point.
await check("/patterns?funnel=faction&scale=count", async () => {
  await page.waitForSelector(".recharts-line", { timeout: 15000 }).catch(() => {});
  const lines = await page.locator(".recharts-line").count();
  return `countLines=${lines}`;
});

// The two blocs must be visibly apart at the committee rung, which is where
// they diverge — 613 against 283. A log axis put them within a few pixels.
await check("/patterns?funnel=bloc&scale=count", async () => {
  await page.waitForSelector(".recharts-line-dots", { timeout: 15000 }).catch(() => {});
  const groups = await page
    .locator(".recharts-line-dots")
    .evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll("circle")].map((c) => Number(c.getAttribute("cy")))));
  const gap = groups.length === 2 ? Math.round(Math.abs(groups[0][2] - groups[1][2])) : 0;

  // The y axis must label the low range, which is where the lines are. d3
  // spaces ticks evenly in value and gave 0/1,000/2,000/3,000 for a 0–3,727
  // range, leaving 283 against 613 unlabelled; Recharts then thins them further
  // unless told not to.
  const yTicks = await page
    .locator(".recharts-cartesian-axis-tick-value")
    .evaluateAll((ns) => ns.map((n) => (n.textContent || "").trim()).filter((t) => /^[\d,]+$/.test(t)));
  const low = yTicks.filter((t) => Number(t.replace(/,/g, "")) > 0 && Number(t.replace(/,/g, "")) <= 900).length;
  return `blocGap=${gap} yTicks=${yTicks.length} lowTicks=${low}`;
});

// Party names run to 60 characters, which a legend cannot carry.
await check("/patterns?funnel=faction&scale=share", async () => {
  await page.waitForSelector(".recharts-line", { timeout: 15000 }).catch(() => {});
  const lines = await page.locator(".recharts-line").count();
  const legend = await page
    .locator(".recharts-legend-item-text")
    .evaluateAll((ns) => ns.map((n) => (n.textContent || "").length));
  return `factionLines=${lines} legendTooLong=${Math.max(0, ...legend) > 26}`;
});

// The patterns page states four measures of the same finding. The assertion
// that matters is the asymmetry: a coalition member's failed bill is killed by
// their own side, an opposition member's is not. If that ever inverts, either
// the politics changed or the bloc data broke.
await check("/patterns", async () => {
  const defeats = await page.locator('[data-testid="pattern-headtohead"] a[href^="/votes/"]').count();
  const closeRows = await page.locator('[data-testid="pattern-close"] li').count();
  const sponsorRows = await page.locator('[data-testid="pattern-throughput"] a[href^="/members/"]').count();
  const killers = await page.locator('[data-testid="pattern-killers"]').innerText();
  // Coalition line quotes a near-total share, opposition line a near-zero one.
  const coal = killers.match(/מהקואליציה[\s\S]*?— ([\d.]+)%/);
  const opp = killers.match(/בממוצע ([\d.]+)% מהמתנגדים היו מאותו\s+גוש — כלומר/);
  const asym = !!coal && !!opp && Number(coal[1]) > 90 && Number(opp[1]) < 10;
  return `defeatRows=${defeats} closeRows=${closeRows} sponsorRows=${sponsorRows} killerAsymmetry=${asym}`;
});

// A failed private bill says whose votes sank it.
await check("/bills/2197256", async () => {
  const note = await page.locator('[data-testid="bill-own-bloc"]').count();
  return `ownBlocNote=${note}`;
});

// A bill that became law but has no summary must say so. Rendering nothing is
// indistinguishable from a broken page, which is how this was reported. 2219672
// is one of the 39 enacted bills the Knesset has not written a summary for.
await check("/bills/2219672", async () => {
  const summary = await page.locator('[data-testid="bill-summary-pending"]').count();
  const explained = summary === 1 && (await page.locator('[data-testid="bill-summary-pending"]').innerText()).includes("טרם פרסמה");
  // The substance is always present even when the summary is not.
  const enacted = await page
    .getByTestId("bill-documents")
    .getByText("פרסום ברשומות")
    .count();
  return `summaryExplained=${explained} enactedText=${enacted}`;
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

// The attendance list is capped so the long tail of occasional visitors does
// not read as a committee's composition, and it must say it is attendance —
// the appointed roster is a separate card, checked above.
await check("/committees/4186", async () => {
  const aside = page.locator("aside");
  const members = await aside.locator('a[href^="/members/"]').count();
  const text = await aside.innerText();
  const capped = /מוצגים \d+ הנוכחים/.test(text);
  const caveat = text.includes("רשימות הנוכחים") && text.includes("זו אינה רשימת ההרכב");
  const chairCount = /יו״ר ×\d/.test(text);
  return `membershipRows=${members} capped=${capped} caveatShown=${caveat} chairCounts=${chairCount}`;
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

// Votes: the list must show tallies, and a vote page must name the members who
// voted rather than falling back to a bare id. `idFallbacks` guards the case
// where the feed's denormalised names are missing — the only way the UI can
// identify a voter, since mkId is a person id space we do not resolve.
await check("/votes", async () => {
  const rows = await page.locator('a[href^="/votes/"]').count();
  const tallied = await page.locator("text=שהצביעו").count();
  return `voteRows=${rows} tallied=${tallied}`;
});

await check("/votes?q=" + encodeURIComponent("תקציב"), async () => {
  const rows = await page.locator('a[href^="/votes/"]').count();
  return `search voteRows=${rows}`;
});

// Follow the first vote through to its own page.
await check("/votes", async () => {
  await page.locator('a[href^="/votes/"]').first().click();
  await page.waitForURL(/\/votes\/\d+/, { timeout: 10000 });
  await page.waitForLoadState("networkidle");
  const names = await page.locator("li.break-words").count();
  const fallbacks = await page.locator("li.break-words", { hasText: /^מזהה \d+$/ }).count();
  const memberLinks = await page.locator('li.break-words a[href^="/members/"]').count();
  const sittingLink = await page.locator('a[href^="/plenum/"]').count();
  return `vote page voterNames=${names} idFallbacks=${fallbacks} memberLinks=${memberLinks} sittingLink=${sittingLink}`;
});

// A sitting must list the votes taken in it, and a member their voting record.
await check("/plenum/2245272", async () => {
  const votes = await page.locator('[data-testid="plenum-votes"] a[href^="/votes/"]').count();
  return `sittingVotes=${votes}`;
});

await check("/members/30719", async () => {
  const card = await page.locator('[data-testid="member-votes"]').count();
  const rows = await page.locator('[data-testid="member-votes"] a[href^="/votes/"]').count();
  return `memberVoteCard=${card} memberVoteRows=${rows}`;
});

// Votes belong inside the timeline, interleaved with the readings, not in a
// section of their own. 2203819 is the 2023 budget: 212 votes over two
// sittings, so the node caps its list and links the sitting for the rest.
await check("/bills/2203819", async () => {
  const inTimeline = await page.locator('ol.border-s li a[href^="/votes/"]').count();
  const ownSection = await page.locator('[data-testid="bill-votes"]').count();
  const moreLink = await page.locator('ol.border-s li a[href^="/plenum/"]').count();
  // Vote nodes must sit between the reading nodes, not all bunched at the end.
  const kinds = await page.locator("ol.border-s > li").evaluateAll((ns) =>
    ns.map((n) => (n.textContent || "").includes("הצבעות במליאה") || (n.textContent || "").includes("הצבעה במליאה") ? "v" : "-").join(""),
  );
  const interleaved = /-v.*-/.test(kinds);
  return `billVotes=${inTimeline} separateSection=${ownSection} moreLink=${moreLink} interleaved=${interleaved}`;
});

await check("/bills/2203819", async () => {
  const href = await page.locator('ol.border-s li a[href^="/votes/"]').first().getAttribute("href");
  await page.goto(S + href, { waitUntil: "networkidle" });
  const back = await page.locator('a[href="/bills/2203819"]').count();
  return `billLinkOnVote=${back}`;
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
