// End-to-end check: scramble and solve the virtual cube through the real UI.
import { chromium } from "playwright-core";
import { Alg } from "cubing/alg";

const KEY_FOR_MOVE = {
  R: "i", "R'": "k", U: "j", "U'": "f", F: "h", "F'": "g",
  L: "d", "L'": "e", D: "l", "D'": "s", B: "o", "B'": "w",
};

function quarterTurns(alg) {
  const out = [];
  for (const node of new Alg(alg).expand().childAlgNodes()) {
    const move = node.toString();
    const m = /^([URFDLB])(2'?|')?$/.exec(move);
    if (!m) throw new Error(`unexpected move ${move}`);
    const suffix = m[2] ?? "";
    if (suffix.startsWith("2")) out.push(m[1], m[1]);
    else out.push(m[1] + suffix);
  }
  return out;
}

const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) problems.push(`[console] ${m.text()}`);
});

await page.goto(process.env.BASE_URL ?? "http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForSelector(".scramble-move");

// Turn on the virtual cube.
await page.locator('.panel', { hasText: 'SMART CUBE' }).locator('input[type="checkbox"]').check();
await page.waitForTimeout(300);

const scramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
console.log("scramble:", scramble);

const press = async (keys, delay = 12) => {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(delay);
  }
};

// Apply the scramble one quarter turn at a time.
const scrambleKeys = quarterTurns(scramble).map((m) => KEY_FOR_MOVE[m]);
await press(scrambleKeys);
await page.waitForTimeout(300);

const afterScramble = {
  hint: await page.locator(".timer-hint").innerText(),
  progress: await page.locator(".panel-head .chip").first().innerText().catch(() => "?"),
  done: await page.locator(".scramble-move.done").count(),
};
console.log("after scramble:", JSON.stringify(afterScramble));

// Now solve it by undoing the scramble.
const solutionKeys = quarterTurns(new Alg(scramble).invert().toString()).map(
  (m) => KEY_FOR_MOVE[m],
);
await press(solutionKeys, 25);
await page.waitForTimeout(600);

const failures = [];
const check = (name, condition, detail) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(name);
};

check("cube reached the scrambled state", afterScramble.hint.startsWith("Ready"), afterScramble.hint);
console.log("timer:", await page.locator(".timer-value").innerText());
console.log("timer hint:", await page.locator(".timer-hint").innerText());
console.log("meta:", await page.locator(".timer-meta").innerText().catch(() => "(none)"));
const solveRows = await page.locator(".solve-row").count();
check("a solve was recorded", solveRows === 1, `${solveRows} rows`);
const phaseRows = await page.locator(".phase-row").count();
check("the solve was broken into CFOP phases", phaseRows === 7, `${phaseRows} phases`);
console.log("stats best:", await page.locator(".stat").nth(1).innerText());


await page.screenshot({ path: "/tmp/e2e.png" });

// Replay dialog.
await page.getByRole("button", { name: "Replay" }).click();
await page.waitForTimeout(1200);
check("the replay opens", (await page.locator(".dialog").count()) === 1);
await page.screenshot({ path: "/tmp/e2e-replay.png" });

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");
