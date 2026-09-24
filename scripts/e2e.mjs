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

await page.goto(process.env.BASE_URL ?? "http://localhost:5199/", { waitUntil: "networkidle" });
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

const solveFreshScramble = async (delay = 25) => {
  const freshScramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
  const freshScrambleKeys = quarterTurns(freshScramble).map((m) => KEY_FOR_MOVE[m]);
  const freshSolutionKeys = quarterTurns(new Alg(freshScramble).invert().toString()).map(
    (m) => KEY_FOR_MOVE[m],
  );
  await press(freshScrambleKeys);
  await page.waitForTimeout(300);
  await press(freshSolutionKeys, delay);
  await page.waitForTimeout(600);
  return { freshScrambleKeys, freshSolutionKeys };
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
const result = page.locator(".solve-result");
check("the center result screen appears", await result.count() === 1);
check("the final result is present", (await result.locator(".result-primary").innerText()).length > 0);
const solveRows = await page.locator(".solve-row").count();
check("a solve was recorded", solveRows === 1, `${solveRows} rows`);
const resultRows = await result.locator(".phase-row").count();
check("the result has seven CFOP phases", resultRows === 7, `${resultRows} phases`);
const rightRows = await page.locator(".column.right .phase-row").count();
check("the right breakdown remains present", rightRows === 7, `${rightRows} phases`);
check("recognition and execution values are numeric", await result.locator(".recognition-value").nth(1).innerText() !== "—" && await result.locator(".execution-value").nth(1).innerText() !== "");
check("cross recognition is unavailable", await result.locator(".recognition-value").first().innerText() === "—");
check("recognition label is explicit", (await result.innerText()).includes("Measured recognition"));
check("move and TPS information is present", (await result.innerText()).includes("Moves / STM") && (await result.innerText()).includes("TPS"));
check("the next scramble is available", await page.locator(".scramble-move").count() > 0);
const timeAxis = result.locator(".phase-time-axis");
const timeLabels = await timeAxis.locator(".phase-time-axis-label").allInnerTexts();
const axisPositions = await timeAxis.locator(".phase-time-axis-label").evaluateAll((labels) =>
  labels.map((label) => label.style.left),
);
const guideTracks = result.locator(".phase-time-guides");
const guideScaleCount = await guideTracks.evaluateAll((guides) => new Set(
  guides.map((guide) => `${guide.dataset.scaleMaxMs}/${guide.dataset.tickMs}`),
).size);
const matchingGuidePositions = await guideTracks.evaluateAll((guides, expectedPositions) => guides.length === 7
  && guides.every((guide) => {
    const positions = Array.from(guide.querySelectorAll("i"), (tick) => tick.style.left);
    return positions.length === expectedPositions.length
      && positions.every((position, index) => position === expectedPositions[index]);
  }), axisPositions);
check("the result has a shared time axis", await timeAxis.count() === 1);
check("the time axis has multiple second labels", timeLabels.length >= 2 && timeLabels.every((label) => /s$/.test(label)));
check("all result bars share one time scale", await guideTracks.count() === 7 && guideScaleCount === 1);
check("guide lines align with the shared axis", matchingGuidePositions);
check("result legend explains measured recognition", (await result.locator(".legend").innerText()).includes("measured recognition")
  && (await result.locator(".legend").innerText()).includes("execution"));

await page.setViewportSize({ width: 390, height: 900 });
const narrowResultLayout = await result.evaluate((element) => {
  const axis = element.querySelector(".phase-time-axis")?.getBoundingClientRect();
  const bars = Array.from(element.querySelectorAll(".phase-row .phase-bar"), (bar) => bar.getBoundingClientRect());
  const body = element.querySelector(".solve-result-body");
  return {
    axisWidth: axis?.width ?? 0,
    axisLeft: axis?.left ?? 0,
    barWidths: bars.map((bar) => bar.width),
    barLefts: bars.map((bar) => bar.left),
    bodyClientWidth: body?.clientWidth ?? 0,
    bodyScrollWidth: body?.scrollWidth ?? 0,
  };
});
const narrowBarsMatchAxis = narrowResultLayout.axisWidth > 0
  && narrowResultLayout.barWidths.length === 7
  && narrowResultLayout.barWidths.every((width) => Math.abs(width - narrowResultLayout.axisWidth) < 0.5)
  && narrowResultLayout.barLefts.every((left) => Math.abs(left - narrowResultLayout.axisLeft) < 0.5);
check("narrow Result keeps the axis aligned with every bar", narrowBarsMatchAxis, JSON.stringify(narrowResultLayout));
check("narrow Result scrolls the shared plotting width", narrowResultLayout.bodyScrollWidth > narrowResultLayout.bodyClientWidth);
await page.setViewportSize({ width: 1440, height: 900 });
console.log("stats best:", await page.locator(".stat").nth(1).innerText());

await result.locator(".solve-result-body").dispatchEvent("pointerdown", { pointerType: "touch" });
check("touch interaction leaves the result visible", await result.count() === 1);
await page.keyboard.press("Escape");
check("Escape dismisses the result", await result.count() === 0);

await page.screenshot({ path: "/tmp/e2e.png" });

// Replay dialog.
await page.locator(".panel", { hasText: "Solve breakdown" }).getByRole("button", { name: "Replay" }).click();
await page.waitForTimeout(1200);
check("the replay opens", (await page.locator(".dialog").count()) === 1);
await page.screenshot({ path: "/tmp/e2e-replay.png" });

await page.locator(".dialog").getByRole("button", { name: "Close" }).click();

await solveFreshScramble();
check("a later solve shows a result again", await result.count() === 1);

// The first move of the auto-generated next scramble must dismiss the result while
// still reaching the scramble tracker.
const nextScramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
const nextScrambleKeys = quarterTurns(nextScramble).map((m) => KEY_FOR_MOVE[m]);
const nextSolutionKeys = quarterTurns(new Alg(nextScramble).invert().toString()).map(
  (m) => KEY_FOR_MOVE[m],
);
await page.keyboard.press(nextScrambleKeys[0]);
await page.waitForTimeout(180);
check("the first next-scramble move dismisses the result", await result.count() === 0);
check("the first next-scramble move is processed", await page.locator(".scramble-move.done").count() >= 1);
await press(nextScrambleKeys.slice(1));
await page.waitForTimeout(250);
await press(nextSolutionKeys, 25);
await page.waitForTimeout(600);

// Selecting an older solve dismisses the transient result before changing the right panel.
await page.locator(".solve-row").nth(1).click();
await page.waitForTimeout(150);
check("historical solve selection dismisses the result", await result.count() === 0);

// Solve again is a replay practice solve, but it is not a slow solve.
await page.locator(".column.right").getByRole("button", { name: "Solve again" }).click();
await page.waitForTimeout(300);
await solveFreshScramble();
check("replay result is visible", await result.count() === 1);
check("replay is not labelled slow solve", await result.getByText("slow solve", { exact: true }).count() === 0);
check("replay keeps elapsed time as the primary result", !/moves$/.test((await result.locator(".result-primary").innerText()).trim()));

await result.getByRole("button", { name: "Continue" }).click();
check("Continue restores the timer", await page.locator(".timer-card").count() === 1);

// A keyboard-timed solve has no move stream, so its elapsed time remains primary.
await page.locator('.panel', { hasText: 'SMART CUBE' }).locator('input[type="checkbox"]').uncheck();
await page.waitForTimeout(300);
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await page.keyboard.down(" ");
await page.waitForTimeout(400);
await page.keyboard.up(" ");
await page.waitForTimeout(50);
await page.keyboard.down(" ");
await page.waitForTimeout(100);
await page.keyboard.up(" ");
await page.waitForTimeout(600);
const keyboardResult = page.locator(".solve-result");
check("keyboard result is visible", await keyboardResult.count() === 1);
if (await keyboardResult.count() === 1) {
  const keyboardPrimary = (await keyboardResult.locator(".result-primary").innerText()).trim();
  check("keyboard result does not fabricate zero moves", !/^0\s+moves$/.test(keyboardPrimary), keyboardPrimary);
  check("keyboard result explains missing move data", (await keyboardResult.innerText()).includes("keyboard-timed solves"));
  check("keyboard result has no Replay action", await keyboardResult.getByRole("button", { name: "Replay" }).count() === 0);
}

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");
