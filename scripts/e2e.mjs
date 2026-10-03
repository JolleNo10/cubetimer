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

// Test page containment separately from intentional horizontal scrollers.
const checkHorizontalOverflow = async (name, selectors = ["html", "body", ".app"]) => {
  const widths = await page.evaluate((selectors) => selectors.flatMap(selector =>
    Array.from(document.querySelectorAll(selector), element => ({
      selector, client: element.clientWidth, scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    })),
  ), selectors);
  const viewport = page.viewportSize().width;
  check(name, widths.length >= selectors.length && widths.every(width =>
    width.scroll <= width.client + 1 && width.left >= -1 && width.right <= viewport + 1), JSON.stringify(widths));
};
const checkControlsFit = async (name, selector) => {
  const bounds = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, height: box.height };
  }));
  check(name, bounds.length > 0 && bounds.every(box => box.width > 0 && box.height > 0
    && box.left >= -1 && box.right <= page.viewportSize().width + 1), JSON.stringify(bounds));
};
const checkMobileDialog = async name => {
  await checkHorizontalOverflow(`${name} keeps page and dialog width contained`, ["html", "body", ".app", ".dialog", ".dialog-body"]);
  await checkControlsFit(`${name} close action fits`, ".dialog-head button");
};

const checkMobileTimer = async (width, height = 844) => {
  await page.setViewportSize({ width, height });
  await checkHorizontalOverflow(`${width}px Timer has no page overflow`, ["html", "body", ".app", ".app-body", ".header", ".scramble-panel"]);
  await checkControlsFit(`${width}px area navigation fits`, '.header-area-switch button');
  await checkControlsFit(`${width}px Settings remains reachable`, '.header button[aria-label="Settings"]');
  const layout = await page.locator(".app-body").evaluate(body => {
    const main = body.querySelector(".column:not(.left):not(.right)").getBoundingClientRect();
    return {
      main: main.top, history: body.querySelector(".column.left").getBoundingClientRect().top,
      stats: body.querySelector(".column.right").getBoundingClientRect().top,
      overflow: getComputedStyle(body).overflowY,
    };
  });
  check(`${width}px Timer remains the first primary content`, layout.main < layout.stats && layout.stats < layout.history, JSON.stringify(layout));
  check(`${width}px Timer owns vertical scrolling`, layout.overflow === "auto");
  const touch = await page.locator(".timer-card").evaluate(element => ({ height: element.getBoundingClientRect().height, touchAction: element.style.touchAction }));
  check(`${width}px timer touch surface remains usable`, touch.height >= 100 && touch.touchAction === "manipulation", JSON.stringify(touch));
  const viewportHeight = await page.locator(".app").evaluate(app => ({ app: app.getBoundingClientRect().height, viewport: window.innerHeight }));
  check(`${width}px app fills the visible viewport`, Math.abs(viewportHeight.app - viewportHeight.viewport) <= 1, JSON.stringify(viewportHeight));
};

const desktopColumns = await page.locator(".app-body").evaluate(body => getComputedStyle(body).gridTemplateColumns.split(" ").length);
check("desktop Timer retains three columns", desktopColumns === 3);
await checkHorizontalOverflow("desktop header and page fit", ["html", "body", ".app", ".header"]);

check("cube reached the scrambled state", afterScramble.hint.startsWith("Ready"), afterScramble.hint);
const result = page.locator(".solve-result");
check("the center result screen appears", await result.count() === 1);
check("the final result is present", (await result.locator(".result-primary").innerText()).length > 0);
const solveRows = await page.locator(".solve-row").count();
check("a solve was recorded", solveRows === 1, `${solveRows} rows`);
const resultRows = await result.locator(".phase-row").count();
check("the result has seven CFOP phases", resultRows === 7, `${resultRows} phases`);
const rightRows = await page.locator(".column.right .phase-row").count();
check("the side column has no duplicate breakdown", rightRows === 0, `${rightRows} phases`);
const recognitionValues = await result.locator(".recognition-value").allInnerTexts();
const executionValues = await result.locator(".execution-value").allInnerTexts();
check("recognition and execution values are numeric",
  recognitionValues.slice(1).some((value) => value.trim() !== "—")
    && executionValues.slice(1).some((value) => value.trim() !== "—"));
check("cross recognition is unavailable", await result.locator(".recognition-value").first().innerText() === "—");
check("recognition label is explicit", (await result.innerText()).includes("Measured recognition"));
check("move and TPS information is present", (await result.innerText()).includes("Moves / STM") && (await result.innerText()).includes("TPS"));
const cumulativeValues = await result.locator(".cumulative-value").allInnerTexts();
const cumulativeSeconds = cumulativeValues.map(Number);
const cumulativeHeading = (await result.locator(".detailed-step-heading").textContent()) ?? "";
check("Result includes a cumulative heading", cumulativeHeading.includes("Cumulative"));
check("all seven Result rows include cumulative time", cumulativeValues.length === 7 && cumulativeSeconds.every(Number.isFinite));
check("cumulative times never decrease", cumulativeSeconds.every((value, index) => index === 0 || value >= cumulativeSeconds[index - 1]), cumulativeValues.join(", "));
check("F2L Slot 4 cumulative time includes earlier F2L steps", cumulativeSeconds[4] >= Math.max(...cumulativeSeconds.slice(1, 4)), cumulativeValues.join(", "));
check("final cumulative time matches the solve time", cumulativeValues[6] === (await result.locator(".result-primary").innerText()).trim(),
  `${cumulativeValues[6]} vs ${(await result.locator(".result-primary").innerText()).trim()}`);
check("Result replaces the move histogram", await result.locator('svg[aria-label="Time taken by each move"]').count() === 0);
check("Result explains the comparison minimum", (await result.innerText()).includes("Complete 3 comparable analyzed solves"));
check("the live ScramblePanel is hidden while Result is open", await page.locator(".scramble-panel").count() === 0);
const timeAxis = result.locator(".phase-time-axis");
const timeLabels = await timeAxis.locator(".phase-time-axis-label").allInnerTexts();
const axisPositions = await timeAxis.locator(".phase-time-axis-label").evaluateAll((labels) =>
  labels.map((label) => label.style.left),
);
const guideTracks = result.locator(".phase-time-guides");
const guideScaleCount = await guideTracks.evaluateAll((guides) => new Set(
  guides.map((guide) => `${guide.dataset.scaleMaxMs}/${guide.dataset.tickMs}`),
).size);
const axisScale = await timeAxis.evaluate((axis) => ({
  scaleMaxMs: axis.dataset.scaleMaxMs,
  tickMs: axis.dataset.tickMs,
}));
const guideScalesMatchAxis = await guideTracks.evaluateAll((guides, expectedScale) => guides.length === 7
  && guides.every((guide) => guide.dataset.scaleMaxMs === expectedScale.scaleMaxMs
    && guide.dataset.tickMs === expectedScale.tickMs), axisScale);
const matchingGuidePositions = await guideTracks.evaluateAll((guides, expectedPositions) => guides.length === 7
  && guides.every((guide) => {
    const positions = Array.from(guide.querySelectorAll("i"), (tick) => tick.style.left);
    return positions.length === expectedPositions.length
      && positions.every((position, index) => position === expectedPositions[index]);
  }), axisPositions);
check("the result has a shared time axis", await timeAxis.count() === 1);
check("the time axis has multiple second labels", timeLabels.length >= 2 && timeLabels.every((label) => /s$/.test(label)));
check("all result bars share one time scale", await guideTracks.count() === 7 && guideScaleCount === 1);
check("all result bars use the axis time scale", guideScalesMatchAxis, JSON.stringify(axisScale));
check("guide lines align with the shared axis", matchingGuidePositions);
check("result legend explains measured recognition", (await result.locator(".legend").innerText()).includes("measured recognition")
  && (await result.locator(".legend").innerText()).includes("execution"));

await page.setViewportSize({ width: 390, height: 900 });
const narrowResultLayout = await result.evaluate((element) => {
  const axis = element.querySelector(".phase-time-axis")?.getBoundingClientRect();
  const bars = Array.from(element.querySelectorAll(".phase-row .phase-bar"), (bar) => bar.getBoundingClientRect());
  const body = element.querySelector(".solve-result-body");
  const breakdown = element.querySelector(".detailed-breakdown");
  return {
    axisWidth: axis?.width ?? 0,
    axisLeft: axis?.left ?? 0,
    barWidths: bars.map((bar) => bar.width),
    barLefts: bars.map((bar) => bar.left),
    bodyClientWidth: body?.clientWidth ?? 0,
    bodyScrollWidth: body?.scrollWidth ?? 0,
    breakdownClientWidth: breakdown?.clientWidth ?? 0,
    breakdownScrollWidth: breakdown?.scrollWidth ?? 0,
  };
});
const narrowBarsMatchAxis = narrowResultLayout.axisWidth > 0
  && narrowResultLayout.barWidths.length === 7
  && narrowResultLayout.barWidths.every((width) => Math.abs(width - narrowResultLayout.axisWidth) < 0.5)
  && narrowResultLayout.barLefts.every((left) => Math.abs(left - narrowResultLayout.axisLeft) < 0.5);
check("narrow Result keeps the axis aligned with every bar", narrowBarsMatchAxis, JSON.stringify(narrowResultLayout));
check("narrow Result scrolls the shared plotting width", narrowResultLayout.breakdownScrollWidth > narrowResultLayout.breakdownClientWidth);
check("narrow Result body avoids horizontal overflow", narrowResultLayout.bodyScrollWidth <= narrowResultLayout.bodyClientWidth + 1, JSON.stringify(narrowResultLayout));
await page.setViewportSize({ width: 1440, height: 900 });
console.log("stats best:", await page.locator(".stat").nth(1).innerText());

await result.locator(".solve-result-body").dispatchEvent("pointerdown", { pointerType: "touch" });
check("touch interaction leaves the result visible", await result.count() === 1);
await page.keyboard.press("Escape");
check("Escape dismisses the result", await result.count() === 0);

const solveComparable = async () => {
  await solveFreshScramble();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
};
await solveComparable();
await solveComparable();
await solveFreshScramble();
check("Result shows comparison after three comparable solves", (await result.innerText()).includes("median of last 3"));
check("Result comparison has all seven steps", await result.locator(".solve-comparison-row:not(.solve-comparison-heading)").count() === 7);
check("Result comparison has no move histogram", await result.locator('svg[aria-label="Time taken by each move"]').count() === 0);
await page.setViewportSize({ width: 390, height: 900 });
const narrowComparisonLayout = await result.evaluate((element) => {
  const body = element.querySelector(".solve-result-body");
  const panel = element.querySelector(".solve-comparison");
  const panelBox = panel?.getBoundingClientRect();
  const rows = Array.from(element.querySelectorAll(".solve-comparison-row:not(.solve-comparison-heading)"), (row) => {
    const box = row.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  return {
    bodyClientWidth: body?.clientWidth ?? 0,
    bodyScrollWidth: body?.scrollWidth ?? 0,
    panelLeft: panelBox?.left ?? 0,
    panelRight: panelBox?.right ?? 0,
    rows,
  };
});
const narrowComparisonRowsFit = narrowComparisonLayout.rows.length === 7
  && narrowComparisonLayout.rows.every((row) => row.left >= narrowComparisonLayout.panelLeft - 0.5
    && row.right <= narrowComparisonLayout.panelRight + 0.5);
check("narrow populated comparison keeps the Result body fixed", narrowComparisonLayout.bodyScrollWidth <= narrowComparisonLayout.bodyClientWidth + 1,
  JSON.stringify(narrowComparisonLayout));
check("narrow populated comparison rows fit the panel", narrowComparisonRowsFit, JSON.stringify(narrowComparisonLayout));
await page.setViewportSize({ width: 1440, height: 900 });

await page.screenshot({ path: "/tmp/e2e.png" });

// Replay dialog.
await page.setViewportSize({ width: 390, height: 844 });
await page.locator(".solve-result").getByRole("button", { name: "Replay", exact: true }).click();
await page.waitForTimeout(1200);
check("the replay opens", (await page.locator(".dialog").count()) === 1);
await checkMobileDialog("mobile Replay");
await checkControlsFit("mobile Replay transport fits", ".replay-transport button, .replay-transport select, .replay-time");
const replayCube = await page.locator(".replay-cube-host").boundingBox();
check("mobile Replay cube has a usable size", replayCube.width >= 240 && replayCube.height >= 180 && replayCube.height < 350, JSON.stringify(replayCube));
check("mobile Replay breakdown remains below the cube", (await page.locator(".replay-steps").boundingBox()).y > replayCube.y + replayCube.height);
const replayStep = page.locator(".replay-steps button.phase-row.selectable").last();
await replayStep.click();
check("mobile Replay step still seeks", Number(await page.getByRole("slider", { name: "Move position" }).inputValue()) > 0);
await page.screenshot({ path: "/tmp/e2e-replay.png" });

await page.locator(".dialog").getByRole("button", { name: "Close" }).click();

await result.getByRole("button", { name: "Back to timer", exact: true }).click();
check("Back to timer closes the Result", await result.count() === 0);
check("Back to timer restores the ScramblePanel", await page.locator(".scramble-panel").count() === 1);
await page.setViewportSize({ width: 900, height: 900 });
await checkHorizontalOverflow("tablet header and page fit", ["html", "body", ".app", ".header", ".app-body"]);
await checkMobileTimer(390);
await checkMobileTimer(430);
await checkMobileTimer(360, 600);
await page.getByRole("button", { name: "Settings", exact: true }).click();
await checkMobileDialog("mobile Settings");
const settingsScroll = await page.locator(".dialog-body").evaluate(body => ({ height: body.clientHeight, scroll: body.scrollHeight, overflow: getComputedStyle(body).overflowY }));
check("mobile Settings body owns vertical scrolling", settingsScroll.scroll > settingsScroll.height && settingsScroll.overflow === "auto", JSON.stringify(settingsScroll));
await checkControlsFit("mobile Settings Done stays reachable", ".dialog-foot button");
await page.getByRole("button", { name: "Done", exact: true }).click();
// Slow-solve actions are another real mobile header/panel wrapping branch.
await page.locator(".header-context input[type=checkbox]").check();
await checkHorizontalOverflow("mobile slow-solve controls stay contained", ["html", "body", ".app", ".app-body", ".scramble-panel"]);
await checkControlsFit("mobile slow-solve scramble actions wrap", ".scramble-actions button, .scramble-actions select");
await page.locator(".header-context input[type=checkbox]").uncheck();
await page.setViewportSize({ width: 1440, height: 900 });
await solveFreshScramble();
check("a later solve shows a result again", await result.count() === 1);

// Back to timer exposes the already-generated next scramble and its tracker.
await result.getByRole("button", { name: "Back to timer", exact: true }).click();
check("the next Result footer returns to the timer", await result.count() === 0);
check("the next ScramblePanel is visible", await page.locator(".scramble-panel").count() === 1);
await page.waitForSelector(".scramble-move.next", { state: "attached", timeout: 3000 });
const nextScramble = (await page.locator(".scramble").innerText()).split("\n").join(" ");
const nextScrambleKeys = quarterTurns(nextScramble).map((m) => KEY_FOR_MOVE[m]);
const nextScrambleFirstMoveKeys = quarterTurns(nextScramble.split(/\s+/)[0]).map((m) => KEY_FOR_MOVE[m]);
const nextSolutionKeys = quarterTurns(new Alg(nextScramble).invert().toString()).map(
  (m) => KEY_FOR_MOVE[m],
);
await page.keyboard.press(nextScrambleFirstMoveKeys[0]);
await page.waitForTimeout(300);
await press(nextScrambleFirstMoveKeys.slice(1));
await page.waitForTimeout(180);
check("the next-scramble move is processed", await page.locator(".scramble-move.done").count() >= 1,
  `${await page.locator(".scramble-move.done").count()} completed moves`);
await press(nextScrambleKeys.slice(nextScrambleFirstMoveKeys.length));
await page.waitForTimeout(250);
await press(nextSolutionKeys, 25);
await page.waitForTimeout(600);

// Selecting an older solve reopens its center Result, including Solve again.
await page.locator(".solve-row").nth(1).click();
await page.waitForTimeout(150);
check("historical solve selection keeps the Result visible", await result.count() === 1);

// Solve again is a replay practice solve, but it is not a slow solve.
await result.getByRole("button", { name: "Solve again", exact: true }).click();
await page.waitForTimeout(300);
await solveFreshScramble();
check("replay result is visible", await result.count() === 1);
check("replay Result shows the recent comparison", await result.locator(".solve-comparison-row:not(.solve-comparison-heading)").count() === 7
  && !(await result.innerText()).includes("Complete 3 comparable analyzed solves"));
check("replay is not labelled slow solve", await result.getByText("slow solve", { exact: true }).count() === 0);
check("replay keeps elapsed time as the primary result", !/moves$/.test((await result.locator(".result-primary").innerText()).trim()));

await result.getByRole("button", { name: "Back to timer", exact: true }).click();
check("Back to timer restores the timer", await page.locator(".timer-card").count() === 1);
check("Back to timer restores the ScramblePanel", await page.locator(".scramble-panel").count() === 1);

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

// All feature areas use the same phone viewport, with their own scroll owner.
if (await keyboardResult.count()) await keyboardResult.getByRole("button", { name: "Back to timer", exact: true }).click();
await page.setViewportSize({ width: 360, height: 800 });
await page.getByRole("navigation", { name: "Application area" }).getByRole("button", { name: "Training", exact: true }).click();
await page.waitForSelector(".f2l-case-button");
await checkHorizontalOverflow("mobile Training has no page overflow", ["html", "body", ".app", ".training-screen", ".training-screen .app-body"]);
await checkControlsFit("mobile Training family switch fits", ".training-family-switch button");
const trainingLayout = await page.locator(".training-screen").evaluate(screen => ({
  library: screen.querySelector(".training-library-column").getBoundingClientRect().top,
  workspace: screen.querySelector(".training-workspace-column").getBoundingClientRect().top,
  target: screen.querySelector(".training-target-column").getBoundingClientRect().top,
  cases: screen.querySelector(".f2l-library").getBoundingClientRect().top,
  connection: screen.querySelector(".connection-panel").getBoundingClientRect().top,
  scrollOwner: getComputedStyle(screen).overflowY,
  nestedOverflow: getComputedStyle(screen.querySelector(".app-body")).overflowY,
}));
check("mobile Training offers cases before workspace and target", trainingLayout.library < trainingLayout.workspace && trainingLayout.workspace < trainingLayout.target && trainingLayout.cases < trainingLayout.connection, JSON.stringify(trainingLayout));
check("mobile Training has one page scroller", trainingLayout.scrollOwner === "auto" && trainingLayout.nestedOverflow === "visible", JSON.stringify(trainingLayout));
const caseBoxes = await page.locator(".f2l-case-button").evaluateAll(buttons => buttons.slice(0, 4).map(button => {
  const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, top: box.top };
}));
check("mobile F2L cases stay tappable in multiple columns", caseBoxes.every(box => box.width >= 44 && box.height >= 44) && caseBoxes[0].top === caseBoxes[1].top, JSON.stringify(caseBoxes));
await page.getByRole("button", { name: "Virtual case", exact: true }).click();
await page.locator(".f2l-case-button").first().click();
await page.locator(".training-workspace-column").scrollIntoViewIfNeeded();
check("mobile Training setup, cube and target remain present", await page.locator(".f2l-setup-panel").count() === 1 && await page.locator(".f2l-stage .cube-view").count() === 1 && await page.locator(".f2l-target-panel").count() === 1);
await page.getByRole("button", { name: "OLL", exact: true }).click();
await page.waitForSelector(".last-layer-case-button");
await checkHorizontalOverflow("mobile OLL catalogue stays contained", ["html", "body", ".app", ".training-screen", ".training-screen .app-body"]);

await page.getByRole("navigation", { name: "Application area" }).getByRole("button", { name: "Statistics", exact: true }).click();
await page.waitForSelector(".stats-chart");
await checkHorizontalOverflow("mobile Statistics has no page overflow", ["html", "body", ".app", ".statistics-page"]);
await checkControlsFit("mobile Statistics filters and navigation fit", ".statistics-controls select, .statistics-controls button, .statistics-navigation button");
const charts = await page.locator(".chart-shell").evaluateAll(shells => shells.map(shell => ({ width: shell.clientWidth, scroll: shell.scrollWidth, overflow: getComputedStyle(shell).overflowX })));
check("mobile Statistics charts pan inside their shells", charts.length > 0 && charts.every(chart => chart.scroll > chart.width && chart.overflow === "auto"), JSON.stringify(charts));
const tables = await page.locator(".table-scroll").evaluateAll(shells => shells.map(shell => ({ width: shell.clientWidth, scroll: shell.scrollWidth, overflow: getComputedStyle(shell).overflowX })));
check("mobile Statistics tables pan inside their shells", tables.length > 0 && tables.some(table => table.scroll > table.width) && tables.every(table => table.overflow === "auto"), JSON.stringify(tables));
await page.locator('.stats-chart g[role="button"]').first().click();
await page.waitForSelector(".statistics-solve-detail");
await checkMobileDialog("mobile Statistics detail");
await page.getByRole("button", { name: "Close solve detail" }).click();

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");
