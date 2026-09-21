// The coach's plans must be right in the frame it shows them in: follow one and the
// cross is done.
import { chromium } from "playwright-core";
import { Alg } from "cubing/alg";

const KEY = { R:"i","R'":"k",U:"j","U'":"f",F:"h","F'":"g",L:"d","L'":"e",D:"l","D'":"s",B:"o","B'":"w" };
const quarters = (alg) => Array.from(new Alg(alg).expand().childAlgNodes()).flatMap((n) => {
  const m = /^([URFDLB])(2'?|')?$/.exec(n.toString());
  const s = m[2] ?? "";
  return s.startsWith("2") ? [m[1], m[1]] : [m[1] + s];
});

const base = process.env.BASE_URL ?? "http://localhost:5199/";
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) problems.push(`[console] ${m.text()}`);
});
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".scramble-move");

// A yellow cross with green in front is the cube's own frame, so the moves the coach
// prints can be typed straight into the virtual cube without translating them.
await page.locator('button[aria-label="Settings"]').click();
await page.selectOption("#crossColour", "yellow");
await page.selectOption("#frontColour", "green");
await page.locator(".dialog-foot button").click();
await page.waitForTimeout(300);

await page.locator(".panel", { hasText: "SMART CUBE" }).locator('input[type="checkbox"]').check();
await page.locator(".chip.toggle input").click();
await page.waitForTimeout(300);

const coach = page.locator(".panel", { hasText: "YELLOW CROSS" }).first();
check("the coach appears in slow solve", (await coach.count()) === 1);

const scramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
for (const m of quarters(scramble)) { await page.keyboard.press(KEY[m]); await page.waitForTimeout(6); }
await page.waitForSelector(".plan-row", { timeout: 20000 });
await page.waitForTimeout(900);

const shortest = Number(/Shortest cross is (\d+)/.exec(await coach.innerText())?.[1] ?? -1);
const plans = await page.locator(".plan-row").count();
check("it offers plans", plans > 0 && shortest > 0, `${plans} plans, shortest ${shortest}`);

const kinds = await page.locator(".plan-kind").allInnerTexts();
const moves = await page.locator(".plan-moves").allInnerTexts();
console.log("   plans:");
for (const [i, kind] of kinds.entries()) {
  console.log(`     ${kind.replace("\n", " ").padEnd(18)} ${moves[i]}`);
}

// An XCross must be listed before a plain cross.
const order = kinds.map((k) => k.split("\n")[0]);
const firstPlain = order.indexOf("Cross");
const lastExtra = order.findLastIndex((k) => k !== "Cross");
check("crosses that finish a pair come first", firstPlain === -1 || lastExtra < firstPlain,
      order.join(", "));

// Follow the first plan: the coach must then say the cross is done.
const plan = moves[0];
for (const m of quarters(plan)) { await page.keyboard.press(KEY[m]); await page.waitForTimeout(40); }
await page.waitForTimeout(1200);
const after = await coach.innerText();
check("following the first plan finishes the cross", after.includes("Cross done."), plan);

// If it claimed a pair, that pair must now be listed as done rather than left.
const claimed = order[0] !== "Cross";
if (claimed) {
  const pairsShown = await coach.locator(".phase-case:not(.muted)").allInnerTexts();
  check("  and the pair it promised is solved", pairsShown.length > 0, pairsShown.join(", "));
}

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll coach checks passed.");
