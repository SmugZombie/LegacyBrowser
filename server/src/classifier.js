const CLOUD_HOSTS = [
  "youtube.com",
  "youtu.be",
  "gmail.com",
  "mail.google.com",
  "docs.google.com",
  "drive.google.com",
  "sheets.google.com",
  "slides.google.com",
  "calendar.google.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "netflix.com",
  "chatgpt.com",
  "openai.com",
  "claude.ai",
  "notion.so",
  "figma.com",
  "slack.com",
  "discord.com",
  "maps.google.com",
  "google.com",
  "web.whatsapp.com",
  "reddit.com",
  "tiktok.com",
  "linkedin.com",
  "spotify.com",
];

const LITE_HOSTS = [
  "wikipedia.org",
  "wikimedia.org",
  "wiktionary.org",
  "bbc.com",
  "bbc.co.uk",
  "arxiv.org",
  "stackoverflow.com",
  "stackexchange.com",
  "developer.apple.com",
  "developer.mozilla.org",
  "mdn.io",
  "gnu.org",
  "ietf.org",
  "w3.org",
  "archive.org",
  "nih.gov",
  "nasa.gov",
  "nytimes.com",
  "theguardian.com",
  "craigslist.org",
];

function hostnameOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host, list) {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function classifyUrl(rawUrl) {
  const host = hostnameOf(rawUrl);
  if (!host) return "lite";
  if (hostMatches(host, CLOUD_HOSTS)) return "cloud";
  if (hostMatches(host, LITE_HOSTS)) return "lite";
  return "lite";
}

export function looksLikeFailedLite(html) {
  if (!html || html.length < 80) return true;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 40) return true;
  if (/enable javascript|please use a modern browser|unsupported browser/i.test(text)) {
    return true;
  }
  return false;
}

export function resolveMode({ preferredMode, osMajor, url, skipLocal }) {
  // Cloud is this project's default: the legacy iPads it targets cannot
  // render most modern sites themselves, so the safe fallback is the
  // gateway's Chromium rather than a guess.
  const preferred = (preferredMode || "cloud").toLowerCase();
  if (preferred === "local" || preferred === "lite" || preferred === "cloud") {
    return preferred;
  }

  if (!skipLocal) {
    const major = Number(osMajor) || 0;
    if (major >= 12) return "local";
  }

  return classifyUrl(url);
}
