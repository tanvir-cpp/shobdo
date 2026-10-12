# Shobdo — Banglish to বাংলা

A small, offline Manifest V3 extension for modern Chromium browsers. Type
Bangla phonetically using Latin letters, without uploading your writing.
Plain JavaScript; no framework, runtime packages, accounts, or remote scripts.

## Install in Chrome

**No Node.js or build step is required to install the source extension.**

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the **`extension`** folder in this project
   (`E:\experiment\extension` in this workspace), not the project root.
4. Pin **Shobdo** from Chrome's extensions menu.
5. **Refresh website tabs that were already open** when you installed it.
6. Open Shobdo's popup, keep **Enable Shobdo** on, and choose **বাংলা**.
7. Focus a supported text field and type `ami banglay likhi` → **আমি বাংলায় লিখি**.

Alternatively, run `npm run build` and load **`dist/shobdo`**. Both folders are
complete unpacked extensions; install only one copy. Chrome Web Store publishing
or a signed CRX is not needed for this local installation.

### Updating an existing installation to 1.1.1

In `chrome://extensions`, click **Reload** on Shobdo's card, confirm **1.1.1** is
shown, and **refresh every website tab** where you want to type. Existing content
scripts keep their old behavior until the page is refreshed. Use only one loaded
copy of Shobdo. If Chrome reports missing assets, load the complete `extension/`
or `dist/shobdo/` directory, not a partial set of files. Existing enabled/mode/
suggestions preferences are preserved; a missing suggestions preference defaults
to on.

#### Facebook/X-style reversed-text repair

Version 1.1.1 fixes two reproduced editing failures: a site rerender resetting
the caret to the start (`ami` becoming `ইমআ`), and a managed editor processing
the original English keystroke in addition to Shobdo's converted insertion.
Shobdo now preserves the active Latin word through verified same-text rerenders
and prevents competing keystroke insertion in recognized Lexical/Draft editors.
Caret recovery is bounded and stops on deliberate navigation, focus/mode changes,
or changed text; it does not continuously override the website's editor.

Chromium regressions use actual **Lexical 0.52**, **Draft.js 0.11.7**, React rich
text and ProseMirror, verifying both visible Bangla and their document state.
These are local editor fixtures, **not verification of your logged-in Facebook
or X composer/comment field**. Those sites can use different versions/plugins.
After reloading Shobdo, refresh Facebook/X and try `ami hi valo` → `আমি হি ভালো`
in an unsent draft. If one field still fails, specify post/comment/reply/message
and the browser version; do not share private draft contents.

## Typing and controls

- **English is the initial mode.** Shobdo does not interfere with ordinary
  English typing until you explicitly choose Bangla.
- **বাংলা:** Latin letters in supported fields convert immediately. The current
  word is recomputed as you type; partial words can change their spelling.
- **English:** inserted text stays exactly as typed.
- **Enable Shobdo:** pause/resume conversion without losing your preferred mode.
- **Suggestions:** enable/disable the local spelling and completion panel.
- **Alt+Shift+S:** toggle the saved mode. This does **not** re-enable Shobdo if
  it is paused. If a browser/OS shortcut conflicts, assign another combination
  at `chrome://extensions/shortcuts` (or the equivalent browser page). The popup
  shows the suggested shortcut; it does not reflect your custom assignment.
- Settings are **global across supported tabs and frames** and saved locally
  across browser sessions. Existing text is not reconverted on a mode change.

### Keep an English word

In Bangla mode, prefix a Latin word with a backtick: type **\`React** to get
**React**. The backtick is consumed when the first Latin letter arrives; the
escape ends at a space, punctuation, digit, or another non-Latin character.
For sentences, URLs, code, or identifiers like `Node.js`, use **English mode**.
Most uppercase acronyms (e.g. `CPU`, `HTML`) are also kept unchanged; reserved
Avro phonetic controls such as `OI`, `OU`, `NG`, `NN`, `DD`, and `TT` still convert.

### Editing

The active Latin word is maintained separately from its visible Bangla output.
While you are still typing it, **Backspace removes the last Latin keystroke**:
`kha` → খা, Backspace → খ, Backspace → ক.

Spaces, punctuation, clicking, navigation keys, selection changes, losing focus,
and changing modes commit that word. After committing, existing Bangla is edited
natively: Shobdo does not reverse-transliterate or guess its original spelling.
To correct an older word phonetically, select the whole word and retype it.
Selecting text and typing replaces only that selection; surrounding text and
unrelated inline formatting are preserved. Pasting is deliberately unchanged.

### Spelling suggestions and faster completion

In Bangla mode, suggestions appear near the active field/caret after **two Latin
letters**. The local vocabulary contains **244 curated everyday words** and
alternative Banglish spellings. Exact common spellings rank first, followed by
short completions and likely typing errors (including swapped letters).

- Type `banlga` → choose **বাংলা**, or `bhlo` → choose **ভালো**.
- Type `ban` and accept **বাংলা** without finishing the word.
- **↑ / ↓** changes the highlighted candidate; **Tab** or a **click** accepts it.
- **Escape** closes the panel. **Enter** keeps its normal newline/submit behavior.
- Acceptance replaces only the currently active word, preserving surrounding
  text and leaving the caret ready to continue. It does not add a space.
- Tab accepts instead of moving focus while the panel is open; close it with
  Escape or disable **Suggestions** in the popup to retain native Tab navigation.
- Raw escaped English words and uppercase acronyms do not show suggestions.
- The panel follows page scrolling and resizing. Moving the caret, committing a
  word, leaving the field, or switching typing mode dismisses it.

Suggestions are optional, not automatic replacements or a full Bangla spell
checker. They do not understand sentence context, guarantee every inflection,
or learn/store your words. Add vocabulary/variants in `extension/suggestions.js`.

## Examples and phonetic spelling

| Type | Result |
| --- | --- |
| `ami` | আমি |
| `tumi` | তুমি |
| `kemon acho` | কেমন আছো |
| `tomar` | তোমার |
| `bhalo` | ভালো |
| `valo` | ভালো |
| `hi` | হি |
| `hai` | হাই |
| `bangla` | বাংলা |
| `ami banglay likhi` | আমি বাংলায় লিখি |
| `tumi kemon acho` | তুমি কেমন আছো |

The engine is **Avro phonetic**, not a character substitution or translation
service. Its contextual rules handle vowel letters/signs, aspirated consonants,
and conjuncts (`kh`, `sh`, `kkh`, etc.). Case-sensitive controls remain useful:
`O` supplies explicit ও/ো, `OI` supplies ঐ/ৈ, and `OU` supplies ঔ/ৌ.
Small whole-word aliases for `acho`, `tomar`, `bhalo`, and `valo` supply the requested
common spellings; their explicit Avro alternatives remain supported.

Banglish is ambiguous. There is no universal spelling or guarantee that every
informal spelling gives your intended word. The suggestion panel offers a small
curated vocabulary rather than silently autocorrecting your writing. See
`extension/engine.js` to extend phonetic aliases independently of the UI.

## Supported fields and honest limitations

- Standard **`input[type=text]`**, **`input[type=search]`**, and **textarea**.
- **Contenteditable** hosts with plain text, inline formatting, paragraph/div
  blocks, and line breaks, including initially empty `<br>` composers.
- Inherited/nested editable text, text adjacent to protected mentions/widgets,
  dynamically mounted fields, and **open-shadow** inputs/contenteditable.
- Real browser regression fixtures verify **React 18 controlled text inputs and
  textareas**, rebuilding React rich text, actual **ProseMirror**, **Lexical** and
  **Draft.js** editors, including their document state after typing and backspace.
- Textareas support multiple lines. Native rich-text whitespace behavior still
  belongs to the browser.
- Password, email, URL, numeric, other non-text input types, disabled, and readonly
  fields are skipped. IME composition and its final committed text stay native.
- Rich-text replacements stay **within one structural text segment**. Selections
  crossing paragraph/BR boundaries or protected widgets are left to native editing
  instead of rewriting structure. Select and retype individual words for phonetic
  corrections. Widget contents themselves are never transliterated.
- Managed editors use **browser/model editing events**, not direct model-DOM mutation.
  If native insertion is refused or an edit cannot be safely intercepted, Shobdo
  leaves it native. Site-specific Quill/Slate/Lexical/Draft/Tiptap integrations,
  their plugins, and their save/send behavior are **not individually verified**.
  Editor-library fixture coverage does not prove every site using it is compatible.
- Google Docs/canvas editors, **closed shadow roots**, arbitrary embedded rich
  objects, and rich list/table structures are not supported. Unknown frameworks
  can reject editing notifications; use English mode if a site behaves unexpectedly.
- **Native undo/redo is not guaranteed for converted keystrokes.** Conversion
  prefers native rich-text insertion, but text inputs still use localized
  programmatic edits; there is no custom undo stack. Use Backspace
  for the active word or select and replace a committed word. Undo/redo is left
  native, not advertised as full transliteration history.
- Browser-internal pages (`chrome://…`), Chrome Web Store, browser PDF viewers,
  and local `file://` pages cannot be used with this configuration. Incognito
  needs your explicit extension permission; it is not enabled by default.
- There is no mobile-browser, Firefox, or Safari package in this project.

## Privacy and permissions

The only explicit extension permission is **`storage`**, for the three settings.
The content-script match patterns cover HTTP/HTTPS pages and frames because
Shobdo must observe editing there. **Chrome may display a read/change website
data warning:** broad site injection is actual access, even though there is no
`tabs`, clipboard, history, or extra host-permissions entry. You can restrict
site access using Chrome's extension settings; conversion then works only where
Chrome permits injection. Refresh the page after changing site access.

Typed text is processed in the content script's local memory. The extension
stores only enabled/mode/suggestions settings; it does not save your writing, log it, use
analytics, fetch dictionaries, or send requests. All engine/UI assets are local.
Extension pages use a restrictive local-script CSP, with no `eval` or inline JS.

## Project structure

```text
extension/                 Load this folder directly in Chrome
  manifest.json            MV3 declaration, site matches, shortcut
  vendor/avro.js            Vendored contextual phonetic engine
  vendor/MPL-1.1.txt        Upstream license
  vendor/AVRO-NOTICE.txt    Provenance, integrity and modifications
  engine.js                Independent phonetic wrapper and common aliases
  suggestions.js           Offline vocabulary, ranking and isolated candidate UI
  content.js               Localized editing and Latin-word composition
  settings.js              Validated storage and live subscriptions
  background.js            Persistent mode shortcut and default initialization
  popup.html/.css/.js      Accessible, minimal controls
  icons/                   PNG 16/32/48/128 and editable source SVG
demo/index.html            Native-field playground (uses the installed extension)
scripts/build.cjs          Validated allowlisted production copy
scripts/demo.cjs           Local playground server
scripts/icons.cjs          Reproducible PNG generator (development only)
scripts/build-fixtures.cjs Local test-only managed-editor bundle
tests/                     Engine, editing, settings, popup and browser checks
dist/shobdo/               Generated production extension
```

## Develop, test, and build

Use Node.js **22 or later**. Dependencies below are **development-only** and do
not ship in the extension. The lockfile pins their resolved versions.

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

- `npm test`: **107 tests** using Node's test runner, jsdom, and isolated browser
  API mocks. Checks contextual transliteration, real script integration, cursor
  and selection behavior, raw English escape, backspace, composition, paste,
  unsupported fields/editors, enable/mode behavior, storage persistence, command
  handler ordering, popup errors/recovery, block/BR/shadow editing, native model
  notifications, suggestion ranking/acceptance/lifecycle, PNG integrity, guarded
  rerender caret recovery, native separators, and competing-event suppression.
- `npm run build`: checks MV3, permission allowlist, script order, asset references,
  version consistency, PNG dimensions, and JavaScript syntax, then writes **`dist/shobdo`** with
  all required local code and license notices. No bundler/download is required.
- `npm run test:browser`: loads the **production build** into Playwright's real
  Chromium with an isolated temporary profile. **26 browser checks** (27 runner
  entries including their parent) exercise real keystrokes, requested phrases,
  native textarea newlines, selection/caret changes, mixed text, actual popup
  changes, rich inline text, password exclusion, and a full browser restart.
  Additional checks cover paragraph/BR/empty fields, protected mentions, dynamic
  and open-shadow/iframe fields, completion/correction click and keyboard acceptance,
  suggestion controls, native form Enter, icons, and real React/ProseMirror models.
  Social-editor regressions cover synchronous/microtask rerenders and actual
  Lexical/Draft.js/React rich-text typing of `ami hi valo`, plus backspace and state.
  It also checks Chrome's shortcut registration/assignment and page JS errors.
  The profile is deleted on completion; screenshots go to
  **`test-results/popup.png`** and **`test-results/playground.png`**.
- `npm run check`: runs the unit/integration tests and build. Browser checks are
  separate because they require the Chromium download.
- `npm run icons`: regenerates the committed PNG assets from the source SVG using
  Playwright Chromium. You do not need this step to install or build the extension.

React, ProseMirror, Lexical and Draft.js are **test-only dependencies**, served
locally by the browser regression harness. `test:browser` first bundles the social
editor fixture with development-only esbuild. None of this bundle ships in Shobdo
or introduces extension runtime requests or a framework requirement.
The legacy Draft.js test fixture overrides its old Immutable dependency with
patched **3.8.4**; production extension assets contain neither package.

Browser checks use the packaged automation Chromium, not your personal Chrome
profile. Playwright synthetic key events did not invoke Chrome's extension
accelerator during verification. Shortcut registration and
the background handler are tested separately; physical shortcut activation is
part of the manual check below. No automated result is presented as proof that
arbitrary third-party websites or their managed editors are compatible.

To see the browser checks, set `SHOBDO_HEADED=1` before running them (PowerShell:
`$env:SHOBDO_HEADED = '1'`). Installation-time npm warnings are not extension
runtime dependencies; the vendored engine works without npm.

### Try the native-field playground

```sh
npm run demo
```

Open **http://localhost:4173** after installing Shobdo. This is a static local
test page, not a web-app substitute for the extension. It never submits or saves
your input. Stop the server with Ctrl+C.

### Manual Chrome checklist

1. Load unpacked; confirm the extension card has no manifest or worker errors.
2. On the playground, English mode should leave `ami` unchanged. Choose বাংলা
   in the popup; clear the field and type each example from the table above.
3. Type `kha`, backspace three times, and check খা → খ → ক → empty.
4. Type a sentence, move the caret into an older word, select that word, and
   retype it. Check the untouched prefix/suffix and insertion position.
5. Type `ami, ` followed by backtick + `React`, then `! bangla`; expect
   `আমি, React! বাংলা`. Paste existing English/Bangla and verify no conversion.
6. Pause Shobdo; typing stays native. Switch the saved mode while paused;
   it must stay paused. Enable again and verify the chosen mode takes effect.
7. Press your physical **Alt+Shift+S** keys with the webpage focused; confirm
   the popup's mode changes and subsequent typing follows it. Resolve shortcut
   conflicts in `chrome://extensions/shortcuts` if necessary.
8. Type in the basic rich-text field, both paragraph blocks, the line-break and
   empty composers, and after the protected mention. Confirm existing content,
   formatting and the mention remain intact. Verify password typing is unchanged.
9. Type `banlga`, accept বাংলা with Tab; try `bhlo` and click ভালো. Navigate the
   candidates with ↑/↓, dismiss with Escape, and test Suggestions off/on.
10. Close/reopen Chrome and confirm enabled/mode/suggestions remain saved. Check an ordinary
   website's standard text field after refreshing it. Inspect the page and
   extension error consoles if the site has its own editing restrictions.

After editing extension source, use **Reload** on its card at
`chrome://extensions` and refresh the website. If you installed `dist/shobdo`,
rebuild before reloading. Changes to the repository alone do not update an
already loaded production copy.

If a particular site still fails, note the **site URL, field/editor name, and
exact typing steps** (without sharing private message content). Browser fixtures
cover reproducible editor classes, not every website's bespoke integration.

## Licensing

Shobdo's original code is under **MIT** (`LICENSE`). The bundled **avro-phonetic
1.1.5** parser is under **Mozilla Public License 1.1**. Its distributed filename
and header say v1.1.4; that is retained from the npm 1.1.5 package, not renamed.
Upstream copyright and complete license are retained in `extension/vendor/` and
copied to production. The source repository contains the vendored file, including
the documented browser/CommonJS bridge modification. Preserve these notices and
meet MPL source obligations when redistributing the covered file.
