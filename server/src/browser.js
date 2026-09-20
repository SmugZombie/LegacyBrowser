const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let browserPromise;

export async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import("playwright");
    browserPromise = chromium.launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });
  }
  return browserPromise;
}

export async function newPage(viewport) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: {
      width: Math.max(320, Math.min(1400, Math.round(viewport?.width || 1024))),
      height: Math.max(240, Math.min(1400, Math.round(viewport?.height || 768))),
    },
    userAgent: CHROME_UA,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.setDefaultNavigationTimeout(30000);
  return { context, page };
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // ignore shutdown races
  }
  browserPromise = null;
}
