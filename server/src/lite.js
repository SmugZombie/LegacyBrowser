export async function snapshotLite(page, { origin, sessionId, pageUrl }) {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.waitForLoadState("networkidle", { timeout: 4000 });
  } catch {
    // many sites never reach network idle
  }
  await new Promise((resolve) => setTimeout(resolve, 350));

  await page.evaluate(
    ({ origin, sessionId }) => {
      const abs = (value) => {
        try {
          return new URL(value, location.href).href;
        } catch {
          return value;
        }
      };
      const proxy = (value) => {
        if (!value) return value;
        const resolved = abs(value);
        if (resolved.startsWith("data:") || resolved.startsWith("blob:")) return resolved;
        return `${origin}/v1/proxy?url=${encodeURIComponent(resolved)}`;
      };

      // Mirror of src/css.js, inlined because a page CSP can block us from
      // injecting a function into the document. Keep the two in sync.
      const proxyAsset = (value, base) => {
        const raw = String(value == null ? "" : value).trim();
        if (!raw || /^(?:data:|blob:|about:|#)/i.test(raw)) return null;
        let resolved;
        try {
          resolved = new URL(raw, base).href;
        } catch {
          return null;
        }
        if (!/^https?:/i.test(resolved)) return null;
        if (resolved.indexOf(`${origin}/v1/proxy`) === 0) return null;
        const encoded = encodeURIComponent(resolved).replace(/\(/g, "%28").replace(/\)/g, "%29");
        return `${origin}/v1/proxy?url=${encoded}`;
      };
      const rewriteCss = (css, base) => {
        if (!css) return css;
        return String(css)
          .replace(/@import\s+(?:"([^"]*)"|'([^']*)')/gi, (match, dq, sq) => {
            const next = proxyAsset(dq !== undefined ? dq : sq, base);
            return next ? `@import "${next}"` : match;
          })
          .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi, (match, dq, sq, bare) => {
            const target = dq !== undefined ? dq : sq !== undefined ? sq : bare;
            const next = proxyAsset(target, base);
            return next ? `url("${next}")` : match;
          });
      };

      document.querySelectorAll("script, noscript, iframe, object, embed, link[rel='preload'], link[rel='modulepreload']").forEach((node) => {
        node.remove();
      });
      document.querySelectorAll("[onload], [onclick], [onerror], [onsubmit], [onmouseover]").forEach((el) => {
        el.removeAttribute("onload");
        el.removeAttribute("onclick");
        el.removeAttribute("onerror");
        el.removeAttribute("onsubmit");
        el.removeAttribute("onmouseover");
      });

      // Inline every sheet we can read, rewriting its url()s against that
      // sheet's own base. Replacing each sheet where it sits preserves the
      // original cascade order, which appending one merged block did not.
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = Array.from(sheet.cssRules || sheet.rules || []);
        } catch {
          continue; // cross-origin sheet; the link loop below proxies its href
        }
        const owner = sheet.ownerNode;
        if (!owner) continue;
        const css = rewriteCss(
          rules.map((rule) => rule.cssText).join("\n"),
          sheet.href || location.href
        );
        if (owner.tagName === "STYLE") {
          owner.textContent = css;
          continue;
        }
        const style = document.createElement("style");
        style.setAttribute("data-legacybrowse", "inlined");
        const media = owner.getAttribute("media");
        if (media) style.setAttribute("media", media);
        style.textContent = css;
        owner.parentNode.insertBefore(style, owner);
        owner.remove();
      }

      // Whatever is left is a sheet we could not read; keep it proxied.
      document.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
        const href = link.getAttribute("href");
        if (!href) {
          link.remove();
          return;
        }
        link.setAttribute("href", proxy(href));
      });

      document.querySelectorAll("[style]").forEach((el) => {
        const value = el.getAttribute("style");
        if (value && value.indexOf("url(") !== -1) {
          el.setAttribute("style", rewriteCss(value, location.href));
        }
      });

      document.querySelectorAll("img").forEach((img) => {
        const src = img.currentSrc || img.getAttribute("src");
        if (src) img.setAttribute("src", proxy(src));
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
      });
      document.querySelectorAll("source, video, audio").forEach((el) => el.remove());

      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:")) return;
        a.setAttribute(
          "href",
          `${origin}/v1/session/${sessionId}/follow?url=${encodeURIComponent(abs(href))}`
        );
      });

      document.querySelectorAll("form").forEach((form) => {
        const action = form.getAttribute("action") || location.href;
        form.setAttribute("method", "GET");
        form.setAttribute("action", `${origin}/v1/session/${sessionId}/follow`);
        let hidden = form.querySelector('input[name="url"]');
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "url";
          form.appendChild(hidden);
        }
        hidden.value = abs(action);
      });

      if (!document.querySelector('meta[name="viewport"]')) {
        const meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        document.head.appendChild(meta);
      }
    },
    { origin, sessionId }
  );

  const html = await page.content();
  const title = (await page.title()) || pageUrl;
  return { html, title };
}
