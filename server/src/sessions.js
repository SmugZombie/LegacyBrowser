import { randomUUID } from "node:crypto";
import { classifyUrl, looksLikeFailedLite, resolveMode } from "./classifier.js";
import { newPage } from "./browser.js";
import { snapshotLite } from "./lite.js";
import { handleInput, startScreencast, stopScreencast } from "./cloud.js";

const sessions = new Map();
// The client heartbeats every 60s while its page is open, so this is three
// missed beats rather than a guess at how long someone might read.
export const IDLE_MS = Number(process.env.SESSION_IDLE_MS) || 5 * 60 * 1000;

// clientId -> session id. One session per device, so a refresh or a second
// tab reuses the existing browser context instead of spawning another.
const clientSessions = new Map();

function publicOrigin(req, configured) {
  if (configured) return configured.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function urlsFor(req, origin, session) {
  const base = `/v1/session/${session.id}`;
  return {
    id: session.id,
    url: session.url,
    mode: session.mode,
    title: session.title || "",
    classified: session.classified,
    liteURL: `${origin}${base}/lite.html`,
    frameURL: `${origin}${base}/frame.jpg`,
    inputURL: `${origin}${base}/input`,
    navigateURL: `${origin}${base}/navigate`,
    modeURL: `${origin}${base}/mode`,
    backURL: `${origin}${base}/back`,
    canGoBack: (session.trail || []).length > 1,
  };
}

export function getSession(id) {
  return sessions.get(id);
}

export async function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.clientId && clientSessions.get(session.clientId) === id) {
    clientSessions.delete(session.clientId);
  }
  try {
    await stopScreencast(session);
  } catch {
    // ignore
  }
  try {
    await session.context?.close();
  } catch {
    // ignore
  }
}

export function sessionPayload(req, session, origin) {
  return urlsFor(req, origin || publicOrigin(req), session);
}

async function ensurePage(session) {
  if (session.page) return session;
  const { context, page } = await newPage(session.viewport);
  session.context = context;
  session.page = page;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      session.url = page.url();
    }
  });
  return session;
}

async function goto(session, url) {
  await ensurePage(session);
  session.url = url;
  await session.page.goto(url, { waitUntil: "domcontentloaded" });
  session.url = session.page.url();
}

async function renderLite(session, origin) {
  await ensurePage(session);
  if (!session.page.url() || session.page.url() === "about:blank") {
    await goto(session, session.url);
  }
  const snap = await snapshotLite(session.page, {
    origin,
    sessionId: session.id,
    pageUrl: session.url,
  });
  session.liteHtml = snap.html;
  session.title = snap.title;
  session.updatedAt = Date.now();
  return snap;
}

async function renderCloud(session) {
  await ensurePage(session);
  if (!session.page.url() || session.page.url() === "about:blank") {
    await goto(session, session.url);
  }
  if (!session.cdp) {
    await startScreencast(session.page, session);
  }
  session.updatedAt = Date.now();
}

function pushTrail(session, url) {
  if (!session.trail) session.trail = [];
  if (session.trail[session.trail.length - 1] !== url) session.trail.push(url);
}

export async function createSession(req, body, origin) {
  const url = body.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    const err = new Error("url must be http(s)");
    err.status = 400;
    throw err;
  }

  const classified = classifyUrl(url);
  const mode = resolveMode({
    preferredMode: body.preferredMode,
    osMajor: body.osMajor,
    url,
    skipLocal: Boolean(body.skipLocal),
  });

  // Reuse this device's existing session rather than opening a second context.
  const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 64) : "";
  if (clientId) {
    const existing = sessions.get(clientSessions.get(clientId));
    if (existing) {
      existing.updatedAt = Date.now();
      if (existing.mode !== mode) {
        await changeMode(req, existing, mode, origin);
      }
      if (existing.url !== url) {
        return navigateSession(req, existing, url, origin);
      }
      // Same device, same page: hand back what is already rendered, history
      // and all. A refresh costs nothing.
      return sessionPayload(req, existing, origin);
    }
  }

  const session = {
    id: randomUUID(),
    url,
    mode,
    classified,
    osMajor: Number(body.osMajor) || 0,
    viewport: body.viewport || { width: 1024, height: 768 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    liteHtml: "",
    frame: null,
    trail: [],
    clientId,
  };
  sessions.set(session.id, session);
  if (clientId) {
    const stale = clientSessions.get(clientId);
    if (stale && stale !== session.id) destroySession(stale);
    clientSessions.set(clientId, session.id);
  }

  if (mode === "local") {
    pushTrail(session, session.url);
    return sessionPayload(req, session, origin);
  }

  if (mode === "lite") {
    const snap = await renderLite(session, origin);
    if (looksLikeFailedLite(snap.html) && classified === "cloud") {
      session.mode = "cloud";
      await renderCloud(session);
    } else if (looksLikeFailedLite(snap.html) && body.preferredMode !== "lite") {
      session.mode = "cloud";
      await renderCloud(session);
    }
    pushTrail(session, session.url);
    return sessionPayload(req, session, origin);
  }

  await renderCloud(session);
  pushTrail(session, session.url);
  return sessionPayload(req, session, origin);
}

export async function navigateSession(req, session, url, origin, options) {
  if (!url || !/^https?:\/\//i.test(url)) {
    const err = new Error("url must be http(s)");
    err.status = 400;
    throw err;
  }
  session.url = url;
  session.classified = classifyUrl(url);
  await goto(session, url);
  if (session.mode === "lite") {
    const snap = await renderLite(session, origin);
    if (looksLikeFailedLite(snap.html)) {
      session.mode = "cloud";
      await renderCloud(session);
    }
  } else if (session.mode === "cloud") {
    if (!session.cdp) await renderCloud(session);
  }
  if (!options || options.push !== false) {
    pushTrail(session, session.url);
  } else if (session.trail && session.trail.length) {
    // A redirect may have landed somewhere else; keep the entry truthful.
    session.trail[session.trail.length - 1] = session.url;
  }
  session.updatedAt = Date.now();
  return sessionPayload(req, session, origin);
}

export async function backSession(req, session, origin) {
  const trail = session.trail || [];
  if (trail.length < 2) {
    const err = new Error("no previous page");
    err.status = 409;
    throw err;
  }
  trail.pop();
  return navigateSession(req, session, trail[trail.length - 1], origin, { push: false });
}

export async function changeMode(req, session, mode, origin) {
  const next = String(mode || "").toLowerCase();
  if (next !== "lite" && next !== "cloud" && next !== "local") {
    const err = new Error("mode must be local, lite, or cloud");
    err.status = 400;
    throw err;
  }
  session.mode = next;
  if (next === "lite") {
    await stopScreencast(session);
    session.cdp = null;
    await renderLite(session, origin);
  } else if (next === "cloud") {
    await renderCloud(session);
  }
  // Changing how a page is rendered is not a navigation; history is untouched.
  session.updatedAt = Date.now();
  return sessionPayload(req, session, origin);
}

export async function sendInput(session, payload) {
  session.updatedAt = Date.now();
  if (session.mode !== "cloud") {
    session.mode = "cloud";
    await renderCloud(session);
  }
  return handleInput(session, payload);
}

export function sweepIdleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > IDLE_MS) {
      destroySession(id);
    }
  }
}

export { publicOrigin };
