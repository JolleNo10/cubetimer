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

// How long each step took, from the selected solve's Result. A step begins when every
// step before it has finished, so those durations say what the clock should read after
// a jump.
const durations = (
  await page.locator(".solve-result .phase-time").allInnerTexts()
).map((t) => Number(t.trim()));
const startTimes = durations.map((_, i) =>
  durations.slice(0, i).reduce((sum, d) => sum + d, 0),
);
console.log("step durations:", durations.join(", "));
console.log("expected start times:", startTimes.map((t) => t.toFixed(2)).join(", "));

await page.locator(".solve-result").getByRole("button", { name: "Review", exact: true }).click();
await page.waitForTimeout(900);

const dialog = page.locator(".dialog");
const replayBreakdown = dialog.locator(".replay-steps .detailed-breakdown");
const replayRows = replayBreakdown.locator(".phase-row");
check("the replay shows the breakdown", await replayRows.count() === 7);
const replayHeading = (await replayBreakdown.locator(".detailed-step-heading").innerText()).trim();
check(
  "the replay has the detailed breakdown headings",
  ["step", "total", "cumulative", "recognition", "execution", "moves", "tps"].every((heading) => replayHeading.toLowerCase().includes(heading)),
  replayHeading,
);
check("the replay has seven cumulative values", await replayBreakdown.locator(".cumulative-value").count() === 7);
check("the replay has recognition and execution split values",
      (await replayBreakdown.locator(".recognition-value").allInnerTexts()).some((value) => value.trim() !== "—")
        && (await replayBreakdown.locator(".execution-value").allInnerTexts()).some((value) => value.trim() !== "—"));
check("the replay has one shared time axis", await replayBreakdown.locator(".phase-time-axis").count() === 1);
const replayAxis = replayBreakdown.locator(".phase-time-axis");
const replayAxisScale = await replayAxis.evaluate((axis) => ({
  scaleMaxMs: axis.dataset.scaleMaxMs,
  tickMs: axis.dataset.tickMs,
}));
const replayGuides = replayBreakdown.locator(".phase-time-guides");
const replayGuideScales = await replayGuides.evaluateAll((guides) => new Set(
  guides.map((guide) => `${guide.dataset.scaleMaxMs}/${guide.dataset.tickMs}`),
).size);
const replayGuidesMatchAxis = await replayGuides.evaluateAll((guides, expectedScale) => guides.length === 7
  && guides.every((guide) => guide.dataset.scaleMaxMs === expectedScale.scaleMaxMs
    && guide.dataset.tickMs === expectedScale.tickMs), replayAxisScale);
check("all replay bars share one time scale", await replayGuides.count() === 7 && replayGuideScales === 1);
check("replay bars use the axis time scale", replayGuidesMatchAxis, JSON.stringify(replayAxisScale));
check("the replay includes step move solutions",
      await replayBreakdown.locator(".phase-moves").count() > 0
        && (await replayBreakdown.locator(".phase-moves").allInnerTexts()).some((moves) => moves.trim().length > 0));
check("the replay has no legacy move histogram",
      await replayBreakdown.locator('svg[aria-label="Time taken by each move"]').count() === 0);
check("the replay has no full-solution block", await replayBreakdown.locator(".solution").count() === 0);
check("the first step is highlighted to begin with",
      (await replayBreakdown.locator(".phase-row.active .phase-name").innerText()).length > 0,
      await replayBreakdown.locator(".phase-row.active .phase-name").innerText());

const scrubber = dialog.locator('input[type="range"][aria-label="Move position"]');
const marker = replayBreakdown.locator(".phase-move.current");
await dialog.getByRole("button", { name: "Play", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll(".replay-steps .phase-move.current").length === 1,
  null,
  { timeout: 15000 },
);
check("starting playback produces exactly one active move indication", await marker.count() === 1);
const annotation = () => marker.first().evaluate((element) => ({
  action: element.dataset.replayAction,
  text: element.textContent?.trim(),
}));
const markerContext = await marker.first().evaluate((element) => ({
  inPhaseMoves: Boolean(element.closest(".phase-moves")),
  inActiveRow: element.closest(".phase-row")?.classList.contains("active") ?? false,
}));
check(
  "the active move is inside the currently relevant step's move sequence",
  markerContext.inPhaseMoves && markerContext.inActiveRow,
  JSON.stringify(markerContext),
);
const playingAnnotation = await page.evaluate(() => {
  const element = document.querySelector(".replay-steps .phase-move.current");
  const pause = Array.from(document.querySelectorAll(".replay-dialog button"))
    .find((button) => button.textContent?.trim() === "Pause");
  if (!element || !pause) throw new Error("Could not capture the playing annotation");
  const result = {
    action: element.dataset.replayAction,
    text: element.textContent?.trim(),
  };
  pause.click();
  return result;
});
await page.waitForFunction(
  () => Array.from(document.querySelectorAll(".replay-dialog button"))
    .some((button) => button.textContent?.trim() === "Play"),
);
const pausedAnnotation = await annotation();
check("pausing keeps the current replay annotation", await marker.count() === 1);
check(
  "pausing keeps the same replay action highlighted",
  pausedAnnotation.action === playingAnnotation.action,
  JSON.stringify({ playingAnnotation, pausedAnnotation }),
);

const advanceButton = dialog.locator(".replay-main .row").first().locator("button").nth(3);
const beforeNext = Number(await scrubber.inputValue());
await advanceButton.click();
const afterNext = Number(await scrubber.inputValue());
const nextAnnotation = await annotation();
check(
  "manual next advances exactly one replay action",
  afterNext === beforeNext + 1 && nextAnnotation.action !== pausedAnnotation.action,
  JSON.stringify({ beforeNext, afterNext, pausedAnnotation, nextAnnotation }),
);

const beforePrevious = Number(await scrubber.inputValue());
await dialog.locator(".replay-main .row").first().locator("button").nth(1).click();
const afterPrevious = Number(await scrubber.inputValue());
const previousAnnotation = await annotation();
check(
  "manual previous returns exactly one replay action",
  afterPrevious === beforePrevious - 1 && previousAnnotation.action === pausedAnnotation.action,
  JSON.stringify({ beforePrevious, afterPrevious, pausedAnnotation, previousAnnotation }),
);

const position = () => dialog.locator(".row.small .dim").first().innerText();
const clock = () => dialog.locator(".row .mono.small").first().innerText();

// Clicking a step must land on the moment it began.
let lastIndex = -1;
for (const [i, expected] of startTimes.entries()) {
  const row = replayRows.nth(i);
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
    const active = (await replayBreakdown.locator(".phase-row.active .phase-name").innerText()).trim();
    check(`  ${name} is then the current step`, active === name, `highlighted: ${active}`);
  }
}

const beforeStep = Number(await scrubber.inputValue());
await advanceButton.click();
const afterStep = Number(await scrubber.inputValue());
check(
  "stepping advances the replay position and keeps a current phase",
  afterStep === beforeStep + 1
    && await replayBreakdown.locator(".phase-row.active").count() === 1,
  `move ${beforeStep} -> ${afterStep}`,
);

const scrubTarget = durations.findIndex((duration, i) => i > 0 && duration > 0);
if (scrubTarget !== -1) {
  const scrubTargetRow = replayRows.nth(scrubTarget);
  const scrubTargetName = (await scrubTargetRow.locator(".phase-name").innerText()).trim();
  await scrubTargetRow.click();
  const scrubTargetPosition = await scrubber.inputValue();
  await replayRows.nth(0).click();
  await scrubber.fill(scrubTargetPosition);
  await page.waitForTimeout(450);
  const scrubbedActive = (await replayBreakdown.locator(".phase-row.active .phase-name").innerText()).trim();
  check("scrubbing updates the active phase", scrubbedActive === scrubTargetName, scrubbedActive);
}

const f2lTarget = durations.findIndex((duration, i) => i >= 1 && i <= 4 && duration > 0);
const playerBeforeFocus = await dialog.locator("twisty-player").elementHandle();
if (f2lTarget !== -1 && playerBeforeFocus) {
  await replayRows.nth(f2lTarget).click();
  await page.waitForTimeout(350);
  const sameAfterF2l = await playerBeforeFocus.evaluate((element) =>
    element === document.querySelector(".replay-dialog twisty-player"));
  check("entering F2L keeps the same twisty-player", sameAfterF2l);

  await replayRows.nth(0).click();
  await page.waitForTimeout(350);
  const sameAfterLeavingF2l = await playerBeforeFocus.evaluate((element) =>
    element === document.querySelector(".replay-dialog twisty-player"));
  check("leaving F2L keeps the same twisty-player", sameAfterLeavingF2l);
}

await page.setViewportSize({ width: 520, height: 1000 });
const narrowReplayLayout = await dialog.evaluate((element) => {
  const body = element.querySelector(".replay-body");
  const breakdown = element.querySelector(".detailed-breakdown");
  return {
    bodyClientWidth: body?.clientWidth ?? 0,
    bodyScrollWidth: body?.scrollWidth ?? 0,
    breakdownClientWidth: breakdown?.clientWidth ?? 0,
    breakdownScrollWidth: breakdown?.scrollWidth ?? 0,
  };
});
check("narrow replay contains breakdown overflow", narrowReplayLayout.breakdownScrollWidth > narrowReplayLayout.breakdownClientWidth);
check("narrow replay body avoids horizontal overflow", narrowReplayLayout.bodyScrollWidth <= narrowReplayLayout.bodyClientWidth + 1,
      JSON.stringify(narrowReplayLayout));

await page.screenshot({ path: "/tmp/replay.png" });
check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll replay checks passed.");
