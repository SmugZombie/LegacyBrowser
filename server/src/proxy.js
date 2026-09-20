import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { rewriteCssUrls } from "./css.js";

const ALLOWED = new Set(["http:", "https:"]);
// Past this we stop buffering and just stream the sheet through unrewritten.
const MAX_CSS_BYTES = 4 * 1024 * 1024;

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function assertPublicHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error("invalid url");
    err.status = 400;
    throw err;
  }
  if (!ALLOWED.has(parsed.protocol)) {
    const err = new Error("only http(s) urls are allowed");
    err.status = 400;
    throw err;
  }
  if (isPrivateHost(parsed.hostname)) {
    const err = new Error("refusing private host");
    err.status = 400;
    throw err;
  }
  return parsed;
}

export function proxyResource(rawUrl, res, origin) {
  const parsed = assertPublicHttpUrl(rawUrl);
  const lib = parsed.protocol === "https:" ? https : http;
  const req = lib.get(
    parsed,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      timeout: 15000,
    },
    (upstream) => {
      const type = upstream.headers["content-type"] || "application/octet-stream";
      const status = upstream.statusCode || 502;
      if (status >= 300 && status < 400 && upstream.headers.location) {
        try {
          const next = new URL(upstream.headers.location, parsed).href;
          upstream.resume();
          return proxyResource(next, res, origin);
        } catch {
          res.status(502).end("bad redirect");
          return;
        }
      }
      res.status(status);
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "public, max-age=120");

      // A proxied sheet has the same problem its parent document had: its
      // url()s would resolve against the gateway. Rewrite them against the
      // sheet's own URL before handing it over.
      if (origin && /^text\/css/i.test(type)) {
        const chunks = [];
        let bytes = 0;
        let overflowed = false;
        upstream.on("data", (chunk) => {
          if (overflowed) return;
          bytes += chunk.length;
          if (bytes > MAX_CSS_BYTES) {
            overflowed = true;
            chunks.length = 0;
            upstream.unpipe?.();
            res.end();
            upstream.destroy();
            return;
          }
          chunks.push(chunk);
        });
        upstream.on("end", () => {
          if (overflowed) return;
          const css = Buffer.concat(chunks).toString("utf8");
          res.end(rewriteCssUrls(css, parsed.href, origin));
        });
        upstream.on("error", () => {
          if (!res.headersSent) res.status(502).end("proxy error");
          else res.end();
        });
        return;
      }

      upstream.pipe(res);
    }
  );
  req.on("timeout", () => {
    req.destroy();
    if (!res.headersSent) res.status(504).end("proxy timeout");
  });
  req.on("error", () => {
    if (!res.headersSent) res.status(502).end("proxy error");
  });
}
