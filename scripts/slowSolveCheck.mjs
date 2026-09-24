// A slow solve is recorded and analysed, but never timed or counted.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
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
await page.locator('.panel', { hasText: 'SMART CUBE' }).locator('input[type="checkbox"]').check();      // virtual cube
await page.locator(".chip.toggle input").click();                   // the mode
await page.waitForTimeout(300);
check("the mode reads as on", (await page.locator(".chip.toggle.on").count()) === 1);

const solve = async () => {
  // Start from a fresh scramble, since finishing a solve leaves the old one on screen.
  await page.locator(".panel", { hasText: "SCRAMBLE" }).getByText("New").click();
  await page.waitForTimeout(600);
  const scramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
  for (const m of quarters(scramble)) { await page.keyboard.press(KEY[m]); await page.waitForTimeout(6); }
  await page.waitForTimeout(250);
  for (const m of quarters(new Alg(scramble).invert().toString())) {
    await page.keyboard.press(KEY[m]); await page.waitForTimeout(20);
  }
  await page.waitForTimeout(700);
};
await solve();

const result = page.locator(".solve-result");
check("the center result appears", await result.count() === 1);
const primary = (await result.locator(".result-primary").innerText()).trim();
check("the primary result is a move count", /^\d+\s+moves$/.test(primary), primary);
check("elapsed time is secondary", await result.locator(".result-secondary").count() === 1);
check("the solve is listed", (await page.locator(".solve-row").count()) === 1);
check("it is marked as a slow solve",
      (await page.locator(".solve-row .phase-case").allInnerTexts()).includes("slow"));
check("it has a breakdown", (await result.locator(".phase-row").count()) === 7);

const best = (await page.locator(".stat").nth(1).innerText()).split("\n")[1].trim();
const count = (await page.locator(".stat").first().innerText()).split("\n")[1].trim();
check("it is not counted in the statistics", best === "—" && count === "0",
      `best ${best}, solves ${count}`);

await result.getByRole("button", { name: "Continue" }).click();

// Turning the mode off and solving again gives an ordinary, counted solve.
await page.locator(".chip.toggle input").click();
await page.waitForTimeout(300);
await solve();
const best2 = (await page.locator(".stat").nth(1).innerText()).split("\n")[1].trim();
check("an ordinary solve afterwards is counted", best2 !== "—", `best ${best2}`);
check("both solves are still listed", (await page.locator(".solve-row").count()) === 2);

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll slow solve checks passed.");
