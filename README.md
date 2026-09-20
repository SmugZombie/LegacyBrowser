# LegacyBrowse

Hybrid browser for **iOS 9+ iPads**: local `WKWebView` on newer iOS, lite DOM snapshots for articles, and a cloud Chromium stream for modern web apps.

**Cloud is the default mode.** The legacy iPads this targets cannot render most modern sites
themselves, so a request with no `preferredMode` resolves to the gateway's Chromium rather than to
a guess. Pick Auto/Lite/Local explicitly to override.

## Run the gateway

```bash
cd server
npm install
npx playwright install chromium
npm start
```

Open http://127.0.0.1:8787 to try Lite/Cloud from a desktop. Point a real iPad at `http://<your-mac-lan-ip>:8787`.

`public/index.html` is deliberately **ES5 + XMLHttpRequest**: it is the only usable client on 32-bit
iPads (mini 1, iPad 2/3/4), whose Safari 9 has no `fetch`, arrow functions, `async`/`await`, flex `gap`
or `object-fit`. Keep it that way unless you are dropping iOS 9 support.

## Install it on the iPad's home screen

On the iPad, open `http://<your-mac-lan-ip>:8787`, tap the share button, then **Add to Home Screen**.
It launches standalone with its own icon and no Safari chrome.

iOS 9 has no Web App Manifest and no service workers (both iOS 11.3), so this is driven by the Apple
meta tags in `public/index.html` rather than `manifest.json` — the manifest is there for Android and
desktop only. There is **no offline support** on iOS 9; the gateway must be reachable.

Because standalone mode has no browser chrome, the shell provides its own **Back** button. History
lives on the gateway (`session.trail`), not in the client: every page in a session is served from the
same `liteURL`, and links are followed *inside* the iframe where the shell cannot observe them, so
neither the iframe's own history nor a client-side trail can track navigation reliably.

**Full screen.** The **Full** button hides the nav bar and status line so the page gets the whole
1024×768; a floating `≡` button in the bottom-right brings them back. It sits bottom-right on purpose
— top-right collides with the login/account controls most sites put there.

The state persists in `localStorage` (`legacybrowse.chromeHidden`), so a session that ended full
screen comes back full screen; tapping `≡` is a choice to show the nav bar and wins on the next
launch. Two guards keep it from stranding you, since the status line is hidden in full screen:
a saved full-screen state is only applied when there is a URL to resume into, and a failed resume
reveals the chrome so the error is visible — without overwriting your preference.

**Resuming where you left off.** The last visited URL and the selected mode are kept in
`localStorage` (`legacybrowse.lastUrl`, `legacybrowse.lastMode`), the URL updated on every
navigation the shell sees — including links followed inside the lite iframe. On the next launch the
app restores both and opens the session automatically. What is stored is the mode you *picked*, not
the one it resolved to: saving the resolved mode would silently turn a single use of Auto into a
permanent pin. Every storage call is wrapped: iOS private browsing and a full quota both throw, and
the app degrades to a normal cold start rather than breaking.

Note that a home-screen web app has its own storage container, separate from Safari's — browse once
inside the installed app before expecting it to remember anything.

**Keeping the screen awake.** iOS 9 has no Wake Lock API (Safari 16.4+), so the shell falls back to
the standard trick of looping a silent 1px inline video (`public/keepawake.mp4`, 1.5 KB, H.264
Constrained Baseline for maximum compatibility). It starts on the first **Go** — iOS requires a real
user gesture — and stays idle until then, so nothing is burned on an A5 until you actually browse.
Modern browsers take the `navigator.wakeLock` path instead and leave the video alone.

> This fallback is **unverified on 9.3.5**. The video technique is documented for iOS 10+; whether it
> defeats auto-lock on 9.3.5 is untested here. The guaranteed method is
> **Settings → General → Auto-Lock → Never** on the iPad.

Icons and splash screens are generated, not hand-made — regenerate with:

```bash
cd server && node tools/make-icons.mjs
```

## Build the iPad app

Open `ios/LegacyBrowse.xcodeproj`, set your signing team, and run on a 64-bit device or simulator. Deployment target is **9.0**. In the app, tap **Gateway** and set the server URL.

- **iOS 15+ Auto** uses on-device WebKit.
- **iOS 12–14 Auto** tries local WebKit, then falls back to the gateway.
- **iOS 9–11 Auto** always uses lite or cloud.

32-bit iPads (iPad 2/3/4, mini 1) need an old `armv7` toolchain and sideloading; they are not part of this tree.

## API

`POST /v1/session` `{ url, preferredMode, osMajor, skipLocal, viewport }`

`POST /v1/session/:id/back` returns to the previous page in the session's trail. The session
payload carries `canGoBack` and `backURL`.
