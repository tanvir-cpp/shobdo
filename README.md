# Shobdo — Banglish to বাংলা

Type Bangla with English letters, fully offline. A tiny Manifest V3 extension
for Chromium browsers: no accounts, no servers, your words never leave the tab.

`ami banglay likhi` → **আমি বাংলায় লিখি**

## Install (1 minute)

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the
   **`extension`** folder (or extract `shobdo-1.1.2.zip` from Releases and pick that).
2. Pin Shobdo, refresh your open tabs, open the popup → **বাংলা**.
3. Type anywhere you can type.

Updating? Replace the folder (or rebuild `dist/shobdo`), hit **Reload** on
Shobdo's card, refresh your tabs.

## How it works

- Starts in **English** so it never hijacks normal typing. Flip to বাংলা in the
  popup or with **Alt+Shift+S**.
- Words convert live as you type; **Backspace** walks the active word back
  letter by letter. Space or punctuation locks the word in.
- `` `React `` keeps one word English. Passwords, pastes, and IME input are
  never touched.
- After 2 letters, a suggestion panel offers fixes (`banlga` → বাংলা):
  **↑/↓** pick, **Tab** accept, **Esc** dismiss. It suggests — never autocorrects,
  learns, or phones home (can be toggled off in the popup).

| `tumi kemon acho` | তুমি কেমন আছো |
| `tomar bhalo` | তোমার ভালো |
| `amar sonar bangla` | আমার সোনার বাংলা |

Powered by Avro phonetic + its 3,720-word autocorrect dictionary, vendored
locally (`extension/vendor/`). Banglish has no standard spelling, so odd words
may need the capital form (`sOnar`) or one Tab.

## Fine print

Works in inputs, textareas, and most rich editors. Skips Docs/canvas, closed
shadow roots, and `chrome://` pages. Converted keystrokes aren't guaranteed
undoable. Only permission is `storage` (3 settings).

## Hack on it

```sh
npm ci && npm test       # run test suite
npm run build            # production copy in dist/shobdo
npm run demo             # playground at http://localhost:4173
```

MIT for our code; bundled Avro engine + dictionary stay MPL-1.1 (OmicronLab).
