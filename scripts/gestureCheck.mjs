// Turning the top face three times should line the view up, but only while idle.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
await page.locator('input[type="checkbox"]').first().check();
await page.waitForTimeout(400);

const flash = page.locator(".cube-flash");
const turn = async (key, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
};

// Idle: three U turns fire it.
await turn("j", 3);
await page.waitForTimeout(300);
check("three U turns while idle centre the view", await flash.count() === 1,
      (await flash.innerText().catch(() => "")).trim());
await page.waitForTimeout(1600);

// Two is not enough, and mixed directions are not the gesture.
await turn("j", 2);
await page.waitForTimeout(300);
check("two U turns do nothing", await flash.count() === 0);
await turn("f", 1);
await turn("j", 1);
await turn("f", 1);
await page.waitForTimeout(300);
check("alternating turns do nothing", await flash.count() === 0);

// Mid-solve, three U turns are just three turns.
const scramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
for (const m of quarters(scramble)) await turn(KEY[m]);
await page.waitForTimeout(300);
await turn("i");                       // first turn starts the timer
await page.waitForTimeout(200);
const solving = (await page.locator(".timer-hint").innerText()).includes("stop the timer");
await turn("j", 3);
await page.waitForTimeout(400);
check("three U turns while solving do nothing", solving && await flash.count() === 0,
      solving ? "" : "timer never started");

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll gesture checks passed.");
