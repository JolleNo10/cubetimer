// The coach's plans must be right in the frame it shows them in: follow one and the
// cross is done, follow a pair's algorithm and that pair goes in, and type the way
// back and the cube is at the scramble again.
import { chromium } from "playwright-core";
import { Alg } from "cubing/alg";

const KEY = { R:"i","R'":"k",U:"j","U'":"f",F:"h","F'":"g",L:"d","L'":"e",D:"l","D'":"s",B:"o","B'":"w" };
const quarters = (alg) => Array.from(new Alg(alg).expand().childAlgNodes()).flatMap((n) => {
  const m = /^([URFDLB])(2'?|')?$/.exec(n.toString());
  if (!m) return [n.toString()];
  const s = m[2] ?? "";
  return s.startsWith("2") ? [m[1], m[1]] : [m[1] + s];
});
/** Only face turns can be typed into the virtual cube: no rotations, no wide moves. */
const typable = (alg) => quarters(alg).every((m) => KEY[m]);

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
const type = async (alg, gap = 40) => {
  for (const m of quarters(alg)) { await page.keyboard.press(KEY[m]); await page.waitForTimeout(gap); }
};
/** Does the F2L list say this slot, named by its colours, is filled? */
const slotSaysDone = async (colours) => {
  const row = page.locator(".slot-row", { hasText: colours }).first();
  return (await row.count()) === 1 && (await row.locator(".plan-kind").innerText()).includes("done");
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

const coach = page.locator(".panel.coach");
check("the coach appears in slow solve", (await coach.count()) === 1);
check("it is headed with the cross colour", (await coach.innerText()).includes("YELLOW CROSS"));

const xCrossLimit = page.locator('[aria-label="XCross maximum moves"]');
check(
  "XCross offers 4, 5 and 6 move limits",
  (await xCrossLimit.count()) === 1 &&
    (await xCrossLimit.locator("option").allTextContents()).join(",") === "4,5,6",
);
await xCrossLimit.selectOption("4");
check("the XCross limit can be changed", (await xCrossLimit.inputValue()) === "4");
await xCrossLimit.selectOption("5");

// A scramble of our own rather than the generated one, so every run of this script
// faces the same cube and the same cases. The app is told to adopt whatever state the
// cube ends up in, which is the same door a solver who scrambles by hand comes in by.
const SCRAMBLE = "F R2 D' F B U' B2 U F' R2 L2 B2 R F' U L U2 D U'";
const half = Math.floor(quarters(SCRAMBLE).length / 2);
for (const m of quarters(SCRAMBLE).slice(0, half)) {
  await page.keyboard.press(KEY[m]); await page.waitForTimeout(6);
}
await page.waitForTimeout(900);
// Nothing is worth searching until the cube is at the position being asked about.
check("it does not plan while the scramble is going on",
      (await page.locator(".plan-row").count()) === 0 &&
      (await coach.innerText()).includes("Finish the scramble"));

for (const m of quarters(SCRAMBLE).slice(half)) {
  await page.keyboard.press(KEY[m]); await page.waitForTimeout(6);
}
await page.locator("button", { hasText: "Use cube state as scramble" }).click();
await page.waitForSelector(".plan-row", { timeout: 30000 });
await page.waitForTimeout(900);

const shortest = Number(/Shortest cross is (\d+)/.exec(await coach.innerText())?.[1] ?? -1);
const plans = await page.locator(".plan-row").count();
check("it offers plans once the scramble is done", plans > 0 && shortest > 0,
      `${plans} plans, shortest ${shortest}`);

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

// Follow the first plan: the coach must then hand over to F2L. What it promises has
// to be read before it is followed, since the panel then belongs to F2L.
const plan = moves[0];
const claimed = await page.locator(".plan-pairs .phase-case").first().innerText();
await type(plan);
await page.waitForTimeout(1200);
let after = await coach.innerText();
check("following the first plan finishes the cross", after.includes("Cross done"), plan);
check("  and the coach moves on to F2L",
      after.includes("YELLOW F2L") && !after.includes("Shortest cross is"));
check("  listing all four slots", (await page.locator(".slot-row").count()) === 4);

// The pair it promised must be the pair that is actually done — by name, not just
// "something got solved".
if (order[0] !== "Cross") {
  check("  and the pair it promised is the one that is solved",
        await slotSaysDone(claimed), `promised ${claimed}`);
}

// Follow a pair's algorithm and that pair must go in. Algorithms with a rotation or a
// wide move cannot be typed into the virtual cube, so take the first one that can.
const slots = await page.locator(".slot-row").all();
let tried = null;
for (const slot of slots) {
  const label = (await slot.locator(".plan-kind").innerText()).split("\n");
  if (label[1] === "done" || label[1] === "buried") continue;
  const alg = await slot.locator(".plan-moves").innerText();
  if (!typable(alg)) continue;
  tried = { name: label[0], case: label[1], alg };
  break;
}
if (!tried) {
  check("a pair's algorithm can be followed", false,
        (await page.locator(".slot-row .plan-kind").allInnerTexts()).join(" | "));
} else {
  await type(tried.alg);
  await page.waitForTimeout(1200);
  const row = page.locator(".slot-row", { hasText: tried.name }).first();
  check(`following ${tried.case} fills the ${tried.name} slot`,
        (await row.locator(".plan-kind").innerText()).includes("done"),
        tried.alg);
}

// The way back must really be the way back: type it and the cube is at the scramble.
const rewind = await coach.locator(".rewind .mono").innerText();
check("it shows the way back to the scramble", rewind.length > 0, rewind);
await type(rewind, 30);
await page.waitForTimeout(1200);
after = await coach.innerText();
check("  and taking it leaves nothing left to undo",
      (await coach.locator(".rewind").count()) === 0, after.split("\n").slice(-2).join(" "));
check("  the coach does not go back to planning crosses",
      after.includes("cross is broken") && !after.includes("Shortest cross is"));

// ------------------------------------------------------------------------------
// Again with white underneath, the grip most people actually use, where the frame the
// coach writes in is not the one the cube reports turns in. Holding white down turns
// the cube over: the coach's R is the real L, its U the real D. Everything it prints
// has to be right in that frame — the moves, and the colours it calls the pairs by.
const UPSIDE_DOWN = { R: "L", L: "R", U: "D", D: "U", F: "F", B: "B" };
const asHeld = (alg) => quarters(alg).map((m) => UPSIDE_DOWN[m[0]] + m.slice(1)).join(" ");

await page.locator('button[aria-label="Settings"]').click();
await page.selectOption("#crossColour", "white");
await page.locator(".dialog-foot button").click();
await page.waitForTimeout(300);
await page.locator(".panel", { hasText: "SCRAMBLE" }).getByText("New").click();
await page.waitForTimeout(500);
// The cube is back at the scramble above, so this second one lands somewhere known.
for (const m of quarters("R U2 F' L2 B D' R2 U B2 L F2 D L' B2 U' R F' D2 L")) {
  await page.keyboard.press(KEY[m]); await page.waitForTimeout(6);
}
await page.locator("button", { hasText: "Use cube state as scramble" }).click();
await page.waitForSelector(".plan-row", { timeout: 30000 });
await page.waitForTimeout(900);
check("it plans a white cross too", (await coach.innerText()).includes("WHITE CROSS"));

const white = await page.locator(".plan-row").all();
let xcross = null;
for (const row of white) {
  const pairs = await row.locator(".plan-pairs .phase-case").allInnerTexts();
  if (pairs.length === 0) continue;
  xcross = { pair: pairs[0], moves: await row.locator(".plan-moves").innerText() };
  break;
}
check("it finds an XCross to check the naming with", xcross !== null);
const filledSlots = async () =>
  (await page.locator(".slot-row .plan-kind").allInnerTexts())
    .filter((t) => t.includes("done"))
    .map((t) => t.split("\n")[0])
    .sort()
    .join(", ");

if (xcross) {
  await type(asHeld(xcross.moves));
  await page.waitForTimeout(1200);
  const held = await coach.innerText();
  check("its moves are written for the cube as held", held.includes("Cross done"),
        `${xcross.moves} (typed as ${asHeld(xcross.moves)})`);
  check("  and the pair it promised is the one that is solved",
        await slotSaysDone(xcross.pair), `promised ${xcross.pair}`);

  // Which pair is solved is a fact about the cube, not about how you say you are
  // holding it. Turning the cube a quarter turn in the settings — the cube itself has
  // not moved — must not rename it: a slot called by its position in the hand would
  // change its name here, a slot called by its colours cannot.
  const before = await filledSlots();
  await page.locator('button[aria-label="Settings"]').click();
  await page.selectOption("#frontColour", "red");
  await page.locator(".dialog-foot button").click();
  await page.waitForTimeout(1200);
  check("  and calls it the same pair however you say you are holding the cube",
        (await filledSlots()) === before && before.length > 0,
        `${before} → ${await filledSlots()}`);
}

check("no console or page errors", problems.length === 0, problems.join(" | "));
await browser.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log("\nAll coach checks passed.");
