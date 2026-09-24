// The replay shows the breakdown, and picking a step jumps to where it began.
import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://localhost:5199/";
const file = process.argv[2] ?? `${process.env.HOME}/Downloads/solves_example.csv`;

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
await page.locator('button[aria-label="Settings"]').click();
await page.locator('input[type="file"][accept*="csv"]').setInputFiles(file);
await page.waitForFunction(() => /Imported \d+ solves across/.test(document.body.innerText), null, { timeout: 60000 });
await page.locator(".dialog-foot button").click();
await page.waitForTimeout(400);
const opts = await page.locator('select[aria-label="Session"] option').allInnerTexts();
await page.selectOption('select[aria-label="Session"]', { label: opts.find((o) => !o.startsWith("+") && o !== "Session 1") });
await page.waitForTimeout(700);
await page.locator(".solve-row").first().click();
await page.waitForTimeout(300);

// How long each step took, from the side panel. A step begins when every step before
// it has finished, so those durations say what the clock should read after a jump.
const durations = (
  await page.locator(".panel", { hasText: "Solve breakdown" }).last()
    .locator(".phase-time").allInnerTexts()
).map((t) => Number(t.trim()));
const startTimes = durations.map((_, i) =>
  durations.slice(0, i).reduce((sum, d) => sum + d, 0),
);
console.log("step durations:", durations.join(", "));
console.log("expected start times:", startTimes.map((t) => t.toFixed(2)).join(", "));

await page.locator(".panel", { hasText: "Solve breakdown" }).getByRole("button", { name: "Replay" }).click();
await page.waitForTimeout(900);

const dialog = page.locator(".dialog");
check("the replay shows the breakdown", await dialog.locator(".replay-steps .phase-row").count() === 7);
check("the first step is highlighted to begin with",
      (await dialog.locator(".phase-row.active .phase-name").innerText()).length > 0,
      await dialog.locator(".phase-row.active .phase-name").innerText());

const position = () => dialog.locator(".row.small .dim").first().innerText();
const clock = () => dialog.locator(".row .mono.small").first().innerText();

// Clicking a step must land on the moment it began.
let lastIndex = -1;
for (const [i, expected] of startTimes.entries()) {
  const row = dialog.locator(".replay-steps .phase-row").nth(i);
  const name = (await row.locator(".phase-name").innerText()).trim();
  await row.click();
  await page.waitForTimeout(450);

  const at = Number((await clock()).trim());
  check(
    `${name} jumps to ${expected.toFixed(2)}s`,
    Math.abs(at - expected) < 0.02,
    `clock reads ${at.toFixed(2)}`,
  );

  const index = Number(/move (\d+)/.exec(await position())?.[1] ?? -1);
  check(`  ${name} never goes backwards`, index >= lastIndex, `move ${index}`);
  lastIndex = index;

  if (durations[i] > 0) {
    const active = (await dialog.locator(".phase-row.active .phase-name").innerText()).trim();
    check(`  ${name} is then the current step`, active === name, `highlighted: ${active}`);
  }
}

await page.screenshot({ path: "/tmp/replay.png" });
check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll replay checks passed.");
