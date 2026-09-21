import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser } from "./browser.js";
import { proxyResource } from "./proxy.js";
import {
  IDLE_MS,
  backSession,
  changeMode,
  createSession,
  destroySession,
  getSession,
  navigateSession,
  publicOrigin,
  sendInput,
  sessionPayload,
  sweepIdleSessions,
} from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_ORIGIN = process.env.GATEWAY_PUBLIC_URL || "";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.static(path.join(__dirname, "../public")));

function originOf(req) {
  return publicOrigin(req, PUBLIC_ORIGIN);
}

function requireSession(req, res) {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return null;
  }
  session.updatedAt = Date.now();
  return session;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "legacybrowse-gateway" });
});

app.post("/v1/session", async (req, res) => {
  try {
    const payload = await createSession(req, req.body || {}, originOf(req));
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "session failed" });
  }
});

app.get("/v1/session/:id", (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  res.json(sessionPayload(req, session, originOf(req)));
});

app.delete("/v1/session/:id", async (req, res) => {
  await destroySession(req.params.id);
  res.json({ ok: true });
});

app.get("/v1/session/:id/lite.html", (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(session.liteHtml || "<!doctype html><title>Lite</title><p>No lite snapshot yet.</p>");
});

app.get("/v1/session/:id/frame.jpg", (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (!session.frame) {
    res.status(503).setHeader("Retry-After", "1").end();
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(session.frame);
});

app.post("/v1/session/:id/input", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    const result = await sendInput(session, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "input failed" });
  }
});

app.post("/v1/session/:id/navigate", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    const payload = await navigateSession(req, session, req.body?.url, originOf(req));
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "navigate failed" });
  }
});

app.post("/v1/session/:id/back", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    res.json(await backSession(req, session, originOf(req)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "back failed" });
  }
});

app.post("/v1/session/:id/mode", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    const payload = await changeMode(req, session, req.body?.mode, originOf(req));
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "mode failed" });
  }
});

app.get("/v1/session/:id/follow", async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    const payload = await navigateSession(req, session, req.query.url, originOf(req));
    if (payload.mode === "cloud") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!doctype html>
<meta name="legacybrowse-mode" content="cloud">
<title>Cloud</title>
<p style="font-family:sans-serif;padding:24px">This page needs the cloud browser. Return to LegacyBrowse and choose Cloud if it did not switch automatically.</p>`);
      return;
    }
    res.redirect(302, payload.liteURL);
  } catch (err) {
    res.status(err.status || 500).send(String(err.message));
  }
});

app.get("/v1/proxy", (req, res) => {
  try {
    proxyResource(req.query.url, res, originOf(req));
  } catch (err) {
    res.status(err.status || 400).send(err.message);
  }
});

// Sweep at least as often as the idle window, so a short window set for
// testing actually takes effect.
setInterval(sweepIdleSessions, Math.max(2000, Math.min(60 * 1000, IDLE_MS))).unref();

const server = app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`LegacyBrowse gateway on http://0.0.0.0:${PORT}`);
});

async function shutdown() {
  server.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
