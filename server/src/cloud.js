export async function startScreencast(page, session) {
  const client = await page.context().newCDPSession(page);
  session.cdp = client;
  session.frame = null;
  session.frameSeq = 0;

  client.on("Page.screencastFrame", async (event) => {
    try {
      session.frame = Buffer.from(event.data, "base64");
      session.frameSeq += 1;
      // Deliberately does NOT touch session.updatedAt: the screencast runs
      // whether or not anyone is fetching frames, so counting it as activity
      // made abandoned cloud sessions immortal.
      await client.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    } catch {
      // session may have closed mid-frame
    }
  });

  const viewport = page.viewportSize() || { width: 1024, height: 768 };
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
}

export async function stopScreencast(session) {
  if (!session?.cdp) return;
  try {
    await session.cdp.send("Page.stopScreencast");
  } catch {
    // ignore
  }
}

function viewportOf(session) {
  return session.page?.viewportSize() || { width: 1024, height: 768 };
}

export async function handleInput(session, payload) {
  const page = session.page;
  if (!page) throw new Error("No page");
  const type = payload?.type;
  const vp = viewportOf(session);

  if (type === "tap") {
    const x = Number(payload.nx) * vp.width;
    const y = Number(payload.ny) * vp.height;
    await page.mouse.click(x, y);
    return { ok: true };
  }

  if (type === "scroll") {
    const dx = Number(payload.dx) || 0;
    const dy = Number(payload.dy) || 0;
    await page.mouse.wheel(dx, dy);
    return { ok: true };
  }

  if (type === "pinch") {
    const scale = Number(payload.scale) || 1;
    const current = page.viewportSize();
    if (current && scale > 0) {
      // Chromium has no true pinch in all builds; emulate a small scroll zoom via wheel + ctrl when possible.
      const delta = scale > 1 ? -120 : 120;
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, delta);
      await page.keyboard.up("Control");
    }
    return { ok: true };
  }

  if (type === "text") {
    await page.keyboard.type(String(payload.text || ""), { delay: 12 });
    return { ok: true };
  }

  if (type === "key") {
    await page.keyboard.press(String(payload.key || "Enter"));
    return { ok: true };
  }

  if (type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
    session.url = page.url();
    return { ok: true, url: session.url };
  }

  throw new Error("Unknown input type");
}
