// Stylesheets reach the iPad from the gateway's origin, so every relative,
// root-relative and protocol-relative url() in them would otherwise resolve
// against the gateway and 404. Rewrite them to go through /v1/proxy, resolved
// against the stylesheet's own base rather than the document's.
//
// lite.js carries a copy of this logic that runs inside the page, where each
// sheet's href is known and a page CSP may block injecting a function. Keep
// the two in sync.

const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const IMPORT_PATTERN = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const SKIP_PATTERN = /^(?:data:|blob:|about:|#)/i;

export function proxiedAssetUrl(value, base, origin) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || SKIP_PATTERN.test(raw)) return null;

  let resolved;
  try {
    resolved = new URL(raw, base).href;
  } catch {
    return null;
  }
  if (!/^https?:/i.test(resolved)) return null;
  if (resolved.startsWith(`${origin}/v1/proxy`)) return null; // already rewritten

  // encodeURIComponent leaves parens alone, which would let a rewritten URL
  // match URL_PATTERN again on a later pass.
  const encoded = encodeURIComponent(resolved).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `${origin}/v1/proxy?url=${encoded}`;
}

export function rewriteCssUrls(css, base, origin) {
  if (!css) return css;
  return String(css)
    .replace(IMPORT_PATTERN, (match, dq, sq) => {
      const next = proxiedAssetUrl(dq !== undefined ? dq : sq, base, origin);
      return next ? `@import "${next}"` : match;
    })
    .replace(URL_PATTERN, (match, dq, sq, bare) => {
      const target = dq !== undefined ? dq : sq !== undefined ? sq : bare;
      const next = proxiedAssetUrl(target, base, origin);
      return next ? `url("${next}")` : match;
    });
}
