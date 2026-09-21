// Seed a solve whose breakdown was stored under the old model, reload, and check it
// comes back rather than being dropped.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:5199/";
const { scramble, moves } = JSON.parse(readFileSync("/tmp/legacysolve.json", "utf8"));

const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) problems.push(`[console] ${m.text()}`);
});

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".scramble-move");
const sessionId = await page.locator('select[aria-label="Session"]').inputValue();

// A solve as an older build would have written it: a breakdown shaped as "phases".
await page.evaluate(
  async ({ sessionId, scramble, moves }) => {
    const solve = {
      id: "legacy-solve-1",
      sessionId,
      createdAt: Date.now() - 60_000,
      rawMs: moves.at(-1).t,
      penalty: "none",
      scramble,
      event: "333",
      source: "smartcube",
      moves,
      analysis: {
        crossFace: "D",
        moveCount: moves.length,
        durationMs: moves.at(-1).t,
        phases: [{ name: "Cross", durationMs: 500, moveCount: 4 }],
        pauses: [],
      },
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cubetimer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("solves", "readwrite");
      tx.objectStore("solves").put(solve);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  { sessionId, scramble, moves },
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".solve-row");
await page.locator(".solve-row").first().click();
await page.waitForTimeout(600);

const breakdown = await page.locator(".panel", { hasText: "Solve breakdown" }).last().innerText();
console.log("--- breakdown after reload ---\n" + breakdown.split("\n").slice(0, 12).join("\n"));

const steps = await page.locator(".phase-row").count();
const cases = await page.locator(".phase-case").allInnerTexts();

// And the repair must be written back, not redone on every load.
const stored = await page.evaluate(async () => {
  const db = await new Promise((resolve) => {
    const request = indexedDB.open("cubetimer");
    request.onsuccess = () => resolve(request.result);
  });
  return new Promise((resolve) => {
    const request = db.transaction("solves").objectStore("solves").get("legacy-solve-1");
    request.onsuccess = () => resolve(request.result?.analysis?.steps?.length ?? null);
  });
});

console.log(`\nstep rows: ${steps} | cases: ${cases.join(" ")} | steps saved to storage: ${stored}`);
console.log("problems:", problems.join(" | ") || "none");
const ok = steps === 7 && cases.includes("T") && stored === 7 && problems.length === 0;
console.log(ok ? "REPAIR CHECK PASSED" : "REPAIR CHECK FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
