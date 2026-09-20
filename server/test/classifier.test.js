import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyUrl, looksLikeFailedLite, resolveMode } from "../src/classifier.js";

describe("classifyUrl", () => {
  it("sends Wikipedia to lite", () => {
    assert.equal(classifyUrl("https://en.wikipedia.org/wiki/IPad"), "lite");
  });

  it("sends YouTube and Gmail to cloud", () => {
    assert.equal(classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "cloud");
    assert.equal(classifyUrl("https://mail.google.com/"), "cloud");
  });
});

describe("resolveMode", () => {
  it("defaults to cloud when no mode is given", () => {
    assert.equal(resolveMode({ osMajor: 15, url: "https://en.wikipedia.org" }), "cloud");
    assert.equal(resolveMode({ preferredMode: "", osMajor: 9, url: "https://en.wikipedia.org" }), "cloud");
  });

  it("honors an explicit cloud override", () => {
    assert.equal(
      resolveMode({ preferredMode: "cloud", osMajor: 15, url: "https://en.wikipedia.org" }),
      "cloud"
    );
  });

  it("uses local WebKit on iOS 15+ auto", () => {
    assert.equal(
      resolveMode({ preferredMode: "auto", osMajor: 15, url: "https://en.wikipedia.org" }),
      "local"
    );
  });

  it("tries local WebKit on iOS 12–14 auto", () => {
    assert.equal(
      resolveMode({ preferredMode: "auto", osMajor: 12, url: "https://www.youtube.com" }),
      "local"
    );
  });

  it("classifies on iOS 9 auto", () => {
    assert.equal(
      resolveMode({ preferredMode: "auto", osMajor: 9, url: "https://en.wikipedia.org/wiki/IPad" }),
      "lite"
    );
    assert.equal(
      resolveMode({ preferredMode: "auto", osMajor: 9, url: "https://docs.google.com/document" }),
      "cloud"
    );
  });

  it("skips local WebKit when the client already fell back", () => {
    assert.equal(
      resolveMode({
        preferredMode: "auto",
        osMajor: 12,
        url: "https://www.youtube.com",
        skipLocal: true,
      }),
      "cloud"
    );
  });
});

describe("looksLikeFailedLite", () => {
  it("flags empty and unsupported-browser pages", () => {
    assert.equal(looksLikeFailedLite(""), true);
    assert.equal(looksLikeFailedLite("<html><body>Please use a modern browser</body></html>"), true);
    assert.equal(
      looksLikeFailedLite("<html><body>" + "The iPad is a tablet computer designed by Apple. ".repeat(8) + "</body></html>"),
      false
    );
  });
});
