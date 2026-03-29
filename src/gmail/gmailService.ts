import { existsSync } from "node:fs";
import type pino from "pino";
import { chromium } from "playwright";
import type { AgentConfig, AppConfig } from "../types.js";

interface GmailContextMessage {
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface GmailSendRequest {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

export class GmailService {
  constructor(
    private readonly appConfig: AppConfig,
    private readonly logger: pino.Logger
  ) {}

  isPromptRelevant(agent: AgentConfig, prompt: string): boolean {
    return agent.permissions.gmailAccess && /(^|[\s.,;:!?])(gmail|correo|email|mail|inbox|bandeja)([\s.,;:!?]|$)/i.test(prompt);
  }

  async buildPromptContext(agent: AgentConfig, prompt: string): Promise<string | undefined> {
    if (!this.isPromptRelevant(agent, prompt)) {
      return undefined;
    }

    return await this.withGmailPage(async (page) => {
      const query = buildGmailQuery(prompt);
      await page.waitForSelector('input[name="q"]', { timeout: 30000 });
      await page.locator('input[name="q"]').fill(query);
      await page.locator('input[name="q"]').press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await page.locator("tr.zA").first().waitFor({ state: "attached", timeout: 30000 });

      const messages = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("tr.zA"))
          .filter((row) => {
            const element = row as HTMLElement;
            return element.offsetParent !== null;
          })
          .slice(0, 5)
          .map((row) => {
            const subject = row.querySelector("span.bog")?.textContent?.trim() ?? "(sin asunto)";
            const fromNode = row.querySelector("span[email], span.yP");
            const from =
              fromNode?.getAttribute("email") ??
              fromNode?.getAttribute("name") ??
              fromNode?.textContent?.trim() ??
              "(sin remitente)";
            const dateNode = row.querySelector("td.xW span");
            const date = dateNode?.getAttribute("title") ?? dateNode?.textContent?.trim() ?? "(sin fecha)";
            const snippet =
              row.querySelector("span.y2")?.textContent?.replace(/^[-\s]+/, "").trim() ?? "(sin snippet)";

            return { subject, from, date, snippet };
          });
      });

      if (!messages.length) {
        return ["GMAIL_CONTEXT", `Consulta usada: ${query}`, "No se han encontrado mensajes visibles en Gmail."].join(
          "\n"
        );
      }

      this.logger.info(
        {
          query,
          count: messages.length
        },
        "gmail web context loaded"
      );

      return formatGmailPromptContext(query, messages);
    });
  }

  async sendEmail(request: GmailSendRequest): Promise<{ summary: string }> {
    if (request.to.length === 0) {
      throw new Error("La accion de Gmail no incluye ningun destinatario.");
    }

    return await this.withGmailPage(async (page) => {
      const composeUrl = buildComposeUrl(request);
      await page.goto(composeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1500);

      const sendButton = page.locator(
        'div[role="button"][data-tooltip^="Send"], div[role="button"][data-tooltip^="Enviar"], div[role="button"][aria-label^="Send"], div[role="button"][aria-label^="Enviar"]'
      );
      await sendButton.first().waitFor({ state: "visible", timeout: 30000 });
      await sendButton.first().click();

      await page
        .locator("text=/Message sent|Mensaje enviado/i")
        .first()
        .waitFor({ state: "visible", timeout: 30000 });

      this.logger.info(
        {
          to: request.to,
          cc: request.cc,
          bcc: request.bcc,
          subject: request.subject
        },
        "gmail web message sent"
      );

      return {
        summary: `He enviado el correo a ${request.to.join(", ")}${request.subject ? ` con asunto "${request.subject}".` : "."}`
      };
    });
  }

  private async withGmailPage<T>(callback: (page: import("playwright").Page) => Promise<T>): Promise<T> {
    if (!existsSync(this.appConfig.gmailStorageStateFile)) {
      throw new Error(
        "Gmail esta permitido para este agente, pero no hay una sesion web guardada. Ejecuta `npm run auth:gmail` para iniciar sesion manualmente en el navegador y guardar el estado local."
      );
    }

    const browser = await chromium.launch({
      channel: this.appConfig.browserChannel,
      headless: true
    });

    try {
      const context = await browser.newContext({
        storageState: this.appConfig.gmailStorageStateFile,
        viewport: { width: 1440, height: 1024 }
      });

      const page = await context.newPage();
      await page.goto("https://mail.google.com/mail/u/0/#inbox", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      if (page.url().includes("accounts.google.com")) {
        throw new Error(
          "La sesion web de Gmail ha caducado o ya no es valida. Vuelve a ejecutar `npm run auth:gmail` para renovarla."
        );
      }

      return await callback(page);
    } finally {
      await browser.close();
    }
  }
}

function buildGmailQuery(prompt: string): string {
  const normalized = prompt.toLowerCase();
  const parts: string[] = ["in:inbox"];

  if (/(no leidos|unread|sin leer)/i.test(normalized)) {
    parts.push("is:unread");
  }

  if (/(hoy|today)/i.test(normalized)) {
    parts.push("newer_than:1d");
  } else {
    parts.push("newer_than:7d");
  }

  const emailMatch = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    parts.push(`from:${emailMatch[0]}`);
  }

  return parts.join(" ");
}

function formatGmailPromptContext(query: string, messages: GmailContextMessage[]): string {
  const lines = [
    "GMAIL_CONTEXT",
    "Estos datos vienen de la sesion web real de Gmail del usuario.",
    `Consulta usada: ${query}`,
    "Usa este contexto como fuente prioritaria y no inventes correos que no aparezcan aqui.",
    ""
  ];

  messages.forEach((message, index) => {
    lines.push(`Mensaje ${index + 1}`);
    lines.push(`Asunto: ${message.subject}`);
    lines.push(`De: ${message.from}`);
    lines.push(`Fecha: ${message.date}`);
    lines.push(`Snippet: ${message.snippet}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function buildComposeUrl(request: GmailSendRequest): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    tf: "1",
    to: request.to.join(","),
    su: request.subject,
    body: request.body
  });

  if (request.cc.length > 0) {
    params.set("cc", request.cc.join(","));
  }

  if (request.bcc.length > 0) {
    params.set("bcc", request.bcc.join(","));
  }

  return `https://mail.google.com/mail/?${params.toString()}`;
}
