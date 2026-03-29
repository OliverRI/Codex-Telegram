import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { chromium } from "playwright";

const browserChannel = process.env.BROWSER_CHANNEL || "msedge";
const stateFile = path.resolve(process.env.GMAIL_STORAGE_STATE_FILE || "./secrets/gmail-storage-state.json");

await fs.mkdir(path.dirname(stateFile), { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel,
  headless: false
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 }
  });
  const page = await context.newPage();

  await page.goto("https://mail.google.com/mail/u/0/#inbox", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  console.log("");
  console.log("Inicia sesion en Gmail en la ventana del navegador.");
  console.log("Cuando veas la bandeja de entrada cargada, vuelve aqui y pulsa Enter.");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await rl.question("");
  rl.close();

  await page.waitForSelector("tr.zA, input[name='q']", { timeout: 30000 });
  await context.storageState({ path: stateFile });

  console.log(`Sesion de Gmail guardada en: ${stateFile}`);
} finally {
  await browser.close();
}
