import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpUrl } from "../src/proxy.js";

describe("assertPublicHttpUrl", () => {
  it("allows public https urls", () => {
    assert.equal(assertPublicHttpUrl("https://upload.wikimedia.org/foo.png").hostname, "upload.wikimedia.org");
  });

  it("rejects private hosts", () => {
    assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/secret"));
    assert.throws(() => assertPublicHttpUrl("http://192.168.1.10/img"));
    assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"));
  });
});
