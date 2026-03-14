import express from "express";
import { CONFIG, isConfigured } from "./config.js";
import {
  processCustomerConfirmation,
  processInboundText,
  processInteractiveReply,
} from "./bot.js";
import { extractIncomingMessage } from "./whatsapp-interactive.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  return res.json({
    ok: true,
    app: CONFIG.appName,
    configured: isConfigured(),
    timezone: CONFIG.timezone,
    now: new Date().toISOString(),
    approval_mode_default: CONFIG.orderFlow.approvalModeDefault,
    webhook: "/webhook",
  });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.wa.verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ error: "Webhook verification failed" });
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];

        for (const msg of messages) {
          const from = msg.from;
          const incoming = extractIncomingMessage(msg);

          if (!incoming) continue;

          if (incoming.kind === "text") {
            const confirmed = await processCustomerConfirmation({
              from,
              text: incoming.text,
            });

            if (!confirmed) {
              await processInboundText({
                from,
                text: incoming.text,
              });
            }
          }

          if (incoming.kind === "button" || incoming.kind === "list") {
            await processInteractiveReply({
              from,
              interactiveId: incoming.id,
              interactiveTitle: incoming.title || "",
            });
          }

          if (incoming.kind === "audio") {
            await processInboundText({
              from,
              text: incoming.text,
            });
          }
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("WEBHOOK_POST_ERROR", error);
    return res.sendStatus(200);
  }
});

app.listen(CONFIG.port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${CONFIG.port}`);
  console.log(`Configured: ${isConfigured()}`);
  console.log(`Approval mode default: ${CONFIG.orderFlow.approvalModeDefault}`);
});
