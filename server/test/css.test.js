import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proxiedAssetUrl, rewriteCssUrls } from "../src/css.js";

const ORIGIN = "http://192.168.1.10:8787";
const SHEET = "https://en.wikipedia.org/w/load.php?modules=skins.vector.styles";

function proxied(css) {
  return rewriteCssUrls(css, SHEET, ORIGIN);
}

function target(css) {
  const m = /url\("([^"]+)"\)/.exec(proxied(css));
  return m ? decodeURIComponent(m[1].slice((ORIGIN + "/v1/proxy?url=").length)) : null;
}

describe("rewriteCssUrls", () => {
  it("routes a root-relative url through the proxy", () => {
    assert.equal(
      target("a { background: url(/w/skins/Vector/images/arrow.svg?5cd6d) }"),
      "https://en.wikipedia.org/w/skins/Vector/images/arrow.svg?5cd6d"
    );
  });

  it("resolves a relative url against the stylesheet, not the document", () => {
    assert.equal(
      target("a { background: url(images/cog.svg) }"),
      "https://en.wikipedia.org/w/images/cog.svg"
    );
  });

  it("gives a protocol-relative url the stylesheet's scheme", () => {
    assert.equal(
      target('a { background: url("//upload.wikimedia.org/lock.svg") }'),
      "https://upload.wikimedia.org/lock.svg"
    );
  });

  it("proxies absolute urls too, so the iPad never talks to the origin", () => {
    assert.equal(
      target("a { background: url(https://upload.wikimedia.org/pdf.png) }"),
      "https://upload.wikimedia.org/pdf.png"
    );
  });

  it("leaves data: and blob: alone", () => {
    const css = "a { background: url(data:image/png;base64,iVBOR) } b { background: url(blob:abc) }";
    assert.equal(proxied(css), css);
  });

  it("handles single quotes and parens inside quoted urls", () => {
    assert.equal(
      target("a { background: url('/img/logo(1).png') }"),
      "https://en.wikipedia.org/img/logo(1).png"
    );
  });

  it("rewrites quoted @import targets", () => {
    const out = proxied('@import "theme.css";');
    assert.match(out, /^@import "http:\/\/192\.168\.1\.10:8787\/v1\/proxy\?url=/);
    assert.match(out, /theme\.css/);
  });

  it("rewrites the url() form of @import", () => {
    assert.equal(target("@import url(theme.css);"), "https://en.wikipedia.org/w/theme.css");
  });

  it("is idempotent - a second pass changes nothing", () => {
    const once = proxied("a { background: url(/w/img/a.svg) }");
    assert.equal(rewriteCssUrls(once, SHEET, ORIGIN), once);
  });

  it("encodes parens so a rewritten url cannot be matched again", () => {
    const once = proxied("a { background: url('/img/logo(1).png') }");
    assert.ok(!/url\("[^"]*\([^"]*"\)/.test(once), "rewritten url still contains a bare paren");
    assert.equal(rewriteCssUrls(once, SHEET, ORIGIN), once);
  });

  it("passes through css with no urls", () => {
    assert.equal(proxied("a { color: red }"), "a { color: red }");
  });
});

describe("proxiedAssetUrl", () => {
  it("declines non-http schemes and empty values", () => {
    assert.equal(proxiedAssetUrl("", SHEET, ORIGIN), null);
    assert.equal(proxiedAssetUrl("data:image/png;base64,AA", SHEET, ORIGIN), null);
    assert.equal(proxiedAssetUrl("javascript:alert(1)", SHEET, ORIGIN), null);
    assert.equal(proxiedAssetUrl("#frag", SHEET, ORIGIN), null);
  });
});
