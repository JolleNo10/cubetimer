// Import a real solve analysis export through the UI and check it lands intact.
import { chromium } from "playwright-core";

const file = process.argv[2] ?? `${process.env.HOME}/Downloads/solves_example.csv`;
const base = process.env.BASE_URL ?? "http://localhost:5199/";

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

const started = Date.now();
await page.locator('button[aria-label="Settings"]').click();
await page.locator('input[type="file"][accept*="csv"]').setInputFiles(file);
await page.waitForFunction(
  () => /Imported \d+ solves across/.test(document.body.innerText),
  null,
  { timeout: 120_000 },
);
const summary = await page.getByText(/Imported \d+ solves across/).innerText();
console.log("import:", summary.trim(), `(${((Date.now() - started) / 1000).toFixed(1)}s)`);
await page.locator(".dialog-foot button").click();
await page.waitForTimeout(500);

// Switch to an imported session and inspect a solve.
const options = await page.locator('select[aria-label="Session"] option').allInnerTexts();
console.log("sessions:", options.filter((o) => !o.startsWith("+")).join(", "));
const imported = options.find((o) => !o.startsWith("+") && o !== "Session 1");
await page.selectOption('select[aria-label="Session"]', { label: imported });
await page.waitForTimeout(800);

const rows = await page.locator(".solve-row").count();
console.log("session", JSON.stringify(imported), "solves listed:", rows);
await page.locator(".solve-row").first().click();
await page.waitForTimeout(400);

const breakdown = await page.locator(".panel", { hasText: "Solve breakdown" }).last().innerText();
if (process.env.VERBOSE) console.log("--- breakdown ---\n" + breakdown);
console.log("stats:", (await page.locator(".stat").nth(1).innerText()).replace("\n", " "));
await page.screenshot({ path: "/tmp/import.png" });

const phaseRows = await page.locator(".phase-row").count();
const ok = rows > 0 && phaseRows === 7 && problems.length === 0;
console.log("\nphase rows:", phaseRows, "| problems:", problems.join(" | ") || "none");
console.log(ok ? "IMPORT CHECK PASSED" : "IMPORT CHECK FAILED");
await browser.close();
process.exit(ok ? 0 : 1);
