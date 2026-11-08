// FPS of the digital shadow (docs/fazy/faza-5-digitalny-tien.md). Usage: see tools/fps/README.md
import { chromium } from "playwright";

const [user, pw] = process.argv.slice(2);
const headed = process.argv.includes("--headed");
const base = process.env.BASE ?? "http://localhost:8000";
const browser = await chromium.launch({ headless: !headed, args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${base}/login`);
await page.fill("input[autocomplete=username], input[name=username], #username", user);
await page.fill("input[type=password]", pw);
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
let scans = 0;
page.on("websocket", (ws) => ws.on("framereceived", (f) => { scans += (String(f.payload).match(/"type":"scan"/g) ?? []).length; }));
await page.goto(`${base}/shadow?depot=BUD&fps=${process.env.MODE ?? "1"}`);
const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
// ROOF=1: the roof open with the sorting line and its parcels (phase 7d step 5d)
if (process.env.ROOF === "1") {
  await page.waitForTimeout(3000);
  await page.click("button[aria-label^='Odkryť strechu']");
}
await page.waitForTimeout(5000); // warm-up
await page.evaluate(() => { window.__shadowFps = []; });
const t0 = Date.now();
scans = 0;
await page.waitForTimeout(20000);
const samples = await page.evaluate(() => window.__shadowFps ?? []);
const clock = await page.locator("text=Čas").locator("xpath=..").innerText().catch(() => "");
const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
console.log(JSON.stringify({ gpu, headed, seconds: (Date.now() - t0) / 1000, samples, avg: Math.round(avg * 10) / 10, min: Math.min(...samples), scansDuringMeasurement: scans, clock: clock.replace(/\s+/g, " ") }, null, 1));
await browser.close();
