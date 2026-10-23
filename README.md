# Navigator

An autonomous browser agent as a Chrome extension (Manifest V3). You describe a goal in plain
language; Navigator plans the steps and drives the live browser — clicking, typing, filling forms,
researching across tabs, and managing your tab tree.

Built with React 18 + Vite + CRXJS, TypeScript (strict), Tailwind v4, Zustand, Dexie, Zod.
LLM backend: Qwen3 over any OpenAI-compatible API, behind a provider abstraction so OpenAI,
Anthropic, Gemini and Ollama can be swapped without touching agent logic.

> **Status:** under active construction, batch by batch. See [Roadmap](#roadmap) for what exists
> today.

---

## Requirements

- Node.js 20.11+ (developed on Node 24)
- pnpm 12 — if `pnpm` is not on your PATH, use `corepack pnpm` in place of every `pnpm` below.
  On Windows, `corepack enable` can fail without admin rights; `corepack pnpm ...` works anyway
  because it downloads pnpm into the corepack cache instead of `Program Files`.
- Chrome (or any Chromium browser) 116+ for the `sidePanel` API

## Setup

```bash
corepack pnpm install          # install dependencies
cp .env.example .env           # optional: build-time default model config
corepack pnpm dev              # watch mode + HMR for the extension
corepack pnpm build            # typecheck, then produce dist/
corepack pnpm test             # unit tests (Vitest)
corepack pnpm typecheck:e2e    # typecheck the Playwright harness
corepack pnpm test:e2e         # end-to-end: the built extension in Chrome for Testing against a local mock (see End-to-end tests)
node scripts/screenshot.mjs    # headless-Chrome screenshot of the side panel (needs `pnpm dev` running)
node scripts/perception-check.mjs  # runs the perception layer on a fixture page in headless Chrome (needs `pnpm dev`)
node scripts/actions-check.mjs     # runs the action executor (click/type/select/scroll) on the fixture (needs `pnpm dev`)
node scripts/overlay-check.mjs     # renders the on-page element map + action highlight in headless Chrome (needs `pnpm dev`)
node scripts/history-shot.mjs      # audit check + screenshot: seeds the log with urls, durations, screenshots and run ids, exports it as JSON, walks the History + Agent tabs (needs `pnpm dev`)
node scripts/settings-shot.mjs     # settings check + screenshot: saves a token price, rejects a malformed one, reloads and verifies it stuck (needs `pnpm dev`)
node scripts/form-check.mjs        # classifies + fills the fixture form end to end in headless Chrome, then asserts the blocked fields stayed empty (needs `pnpm dev`)
node scripts/profiles-shot.mjs     # walks the Profiles tab: create vault, edit profile, lock, unlock, and screenshots each state (needs `pnpm dev`)
node scripts/research-check.mjs    # runs the whole research pipeline over fixture pages in headless Chrome: plan, gather, score, synthesise, export, store (needs `pnpm dev`)
node scripts/research-shot.mjs     # seeds two finished reports and walks the Research tab: report, hover sources, export, copy, tab budget, past runs (needs `pnpm dev`)
node scripts/tabs-check.mjs        # runs the tab manager end to end in headless Chrome: commands, grouping, dedupe, staleness, memory, undo, sessions, index (needs `pnpm dev`)
node scripts/tabs-shot.mjs         # walks the Tabs tab against a fake browser: index, free, merge, search, group, close + undo, stale, selection, sessions (needs `pnpm dev`)
node scripts/recipes-check.mjs     # recipes check + screenshot: saves a finished run as a recipe from History, replays it with fake tools, self-heals a dead step, schedules it, exports and re-imports the JSON (needs `pnpm dev`)
node scripts/palette-check.mjs     # keyboard-only run through the command palette in headless Chrome: shortcut, focus, groups, disabled reasons, navigation, theme persistence, live regions (needs `pnpm dev`)
```

### Load the extension in Chrome

1. Run `corepack pnpm build` (or leave `corepack pnpm dev` running).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this repo's `dist/` folder.
5. Click the Navigator toolbar icon — the **side panel** opens (Navigator uses a side panel, not a
   popup, because popups close the moment you click the page).
6. On the **Agent** tab, click **Test page connection**. It should report the title, URL and scroll
   position of the active tab.

In `dev` mode, editing source reloads the extension automatically. If the service worker looks
stale, hit the reload icon on the extension card in `chrome://extensions`.

### Pages Chrome will not let us touch

`chrome://` pages, the Chrome Web Store, the PDF viewer and the New Tab page reject content
scripts. On those tabs the wiring check reports "Content script is not running on this tab" — that
is Chrome's restriction, not a bug.

---

## Project layout

```
src/
  manifest.ts        MV3 manifest as typed TS; every permission is justified inline
  background/        service worker — agent orchestrator, message routing
  content/           content script — perception + action performer
  sidepanel/         React UI (Agent | Research | Tabs | Profiles | History | Settings)
    panels/          one component per tab
    components/       CommandPalette and the shared UI primitives
  commands/          the palette's command list and matcher — pure, no React
  types/             shared, typed message contracts between the three contexts
  lib/               framework-agnostic helpers
  styles/            Tailwind entry point + design tokens
e2e/                 Playwright flows, the mock server they run against and their page fixtures
fixtures/            local pages the headless Chrome checks load from the dev server
scripts/             headless-Chrome checks and screenshots for one feature each
```

Also under `src/`: `agent/` (planner + executor loop), `llm/` (provider abstraction),
`tools/` (registry + executor), `memory/` (Dexie + crypto + profile vault + research store +
long-term notes), `safety/` (risk scorer, guard), `prompts/` (system prompt templates),
`forms/` (field classifier + fill planner), `research/` (plan → gather → synthesise pipeline,
exports and follow-up retrieval), `recipes/` (record a run, replay it without a model, schedule it),
and `tabs/` (tab manager: command parsing, clustering, duplicates, staleness, memory saver,
semantic search, sessions and the undo buffer — none of it imports Chrome).

## Permissions — why each one

| Permission        | Needed for                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `sidePanel`       | Primary UI surface                                                          |
| `storage`         | Model config, Auto mode site list, audit log                                |
| `tabs`            | `list_tabs` / `switch_tab` / `close_tabs`, plus URL + title for page state   |
| `tabGroups`       | `group_tabs` tool and automatic tab grouping                                |
| `activeTab`       | Act on the tab the user invoked Navigator from                              |
| `debugger`        | Chrome DevTools Protocol fallback when synthetic events fail (React controlled inputs, canvas, cross-frame input) |
| `downloads`       | `download_file` tool                                                        |
| `alarms`          | Scheduled recipe replay                                                     |
| `webNavigation`   | Load-state and network-idle detection for `wait_for`                        |
| `<all_urls>` host | The agent must work on whatever site you ask about. Safety is enforced in-app by the domain blocklist and per-action risk scorer, not by withholding host access. |

Deliberately **not** requested: `history`, `bookmarks`, `cookies`, `notifications`, `identity`.

## Model configuration

`.env` values are **build-time defaults only** — Vite inlines `VITE_*` into the bundle, so never
put a real API key there or commit it. Runtime configuration (base URL, API key, model name,
temperature, max tokens, context window) is edited in the Settings tab and stored locally in the
browser. Keys never leave your machine except in direct calls to the endpoint you configured.

## Cost meter

The Settings tab has a **Cost meter** card where you enter your own price per million tokens plus a
currency symbol (up to 3 characters). Nothing is fetched from a price list, because endpoint pricing
changes and the extension has no way to verify it.

With no price saved, every readout says `no price set` instead of inventing a `₹0.00`. With a price
saved you get `≈₹1.90` style estimates on the Agent run summary, Research reports, Tabs reports and
each History run. Everything is priced at the main model's rate — the summariser and the field-value
judge use cheaper models, so the estimate deliberately errs high rather than looking better than
reality.

The same card also flags runs that beat the spec targets (12,000 tokens and 2.5 s per step). History
shows a run's median step time and lists the steps that overran, so a slow or chatty run is visible
without opening the log.

Use **Stop estimating** to delete the stored price; the numbers revert to raw token counts.

## Profile vault and form filling

Profiles (name, address, links, work history, skills, canned answers) live in IndexedDB as
AES-GCM envelopes. The key is derived from your passphrase with PBKDF2-SHA256 at 310,000 rounds
and is held **only in the service worker's memory** — locking the vault, or Chrome recycling the
worker, makes the rows unreadable again. There is no recovery passphrase.

`fill_form` classifies each field from its label, name, id, placeholder and nearby text. Fields it
is sure about are typed straight from the vault; a field with two plausible values is offered to
the small model as a multiple-choice question that contains **only those candidate values**, never
the whole profile. Dropdown answers are fuzzy-matched to the option text the page actually offers,
dates are rewritten into the format the field asks for, and long values are trimmed to `maxlength`.

Payment, password, OTP, CAPTCHA, consent, file-upload and government-id fields are never filled.
They are outlined in red on the page so you can see what is left, and the tool reports only
`label <- profileKey` back to the model — the values themselves never enter the transcript. The
form is never submitted by `fill_form`.

## Feature B — research engine

Ask a question in the **Research** tab and pick a depth: quick (3-4 sub-questions), standard
(4-6) or deep (5-8 plus a second gather round). Navigator then:

1. **Plans** — decomposes the question into sub-questions and search queries (model plan, or a
   fixed set of research angles when no model is configured).
2. **Gathers** — opens background tabs through one bounded queue (default 4, hard ceiling 8,
   adjustable in the tab), reads each page's main content, byline and date, and ranks the results
   page itself so social chrome, login walls and tracking URLs are never followed.
3. **Scores before it spends** — a keyword gate discards off-topic pages before any token is paid;
   the cheap model then rates relevance and credibility, and anything below **0.4** is dropped and
   reported as dropped.
4. **Synthesises** — map-reduce: summarise each source, cluster the claims, and compose an answer
   with inline `[1][2]` citations. Citation numbers are validated, so a number the engine never
   issued cannot appear in the report.
5. **Flags disagreements** — when sources contradict each other both sides are printed with their
   own citations. The engine never picks a side silently.

Every sentence can be hovered to see which sources back it (the model's own markers when it left
them, content matching otherwise). The report exports as Markdown, comparison table, CSV, JSON —
shaped by an optional output schema — or a bullet brief, to the clipboard or a download. Follow-up
questions are answered from the stored corpus only, never by re-reading the web, and past runs
reopen from IndexedDB with their sources intact.

Page text is treated as untrusted everywhere: it is fenced and stripped by the same sanitizer the
agent loop uses before it reaches a prompt.

---

## Feature C — tab manager

Type a sentence into the **Tabs** tab — "close all YouTube tabs", "group my work tabs", "find the
tab with the pricing page", "save this session for tomorrow" — or press a quick action that names
the same intent. Rules read the sentence first; the small model is only asked when the rules cannot
tell, and it may choose a scope, never a verb it was not given.

- **Auto-grouping** clusters tabs by a local term-weighted similarity over title, host and path
  (cosine, greedy agglomerative, window-scoped because Chrome groups cannot span windows). The
  cheap model names each cluster; a nonsense or missing reply falls back to the site label.
- **Duplicate merge** compares canonical URLs, so `www.`, a `#fragment` and `?utm_*` collapse to
  one page. The live copy stays and a pinned tab is never closed as a duplicate.
- **Stale sweeper** reports tabs whose last activation or completed load we recorded more than X
  days ago. It proposes only — closing is a click, and the suggestion never includes the active,
  pinned or `chrome://` tabs. Chrome gives no per-tab usage clock, so the extension records one
  itself in `tabStats`.
- **Memory saver** calls `discard()` on the heaviest inactive tabs and reports the bytes released as
  an estimate derived from the indexed page weight, labelled as an estimate.
- **Semantic tab search** ranks open tabs by title and URL always, and by page text once a tab has
  been indexed. Each result says which of the two matched, so the UI never implies a page was read
  when it was not.
- **Sessions** store every open URL with a name, tags and a note in IndexedDB; restoring reopens only
  what is missing.
- **Bulk operations** push a snapshot into one 60-second undo buffer owned by the service worker, so
  the panel and the agent's tab tools share a single UNDO. The banner counts down, and an expired
  buffer says so instead of reopening half a window.

The agent gets the same engine through twelve tools (`list_tabs`, `close_tabs`, `group_tabs`,
`close_duplicate_tabs`, `search_tabs`, `suspend_heavy_tabs`, `save_session`, …), so a task can tidy
tabs mid-flight. Closing the only tab in a window is refused: that would close the window.

---

## Recipes

A run that went well can be saved and replayed. Every successful run card — on the Agent tab while
it finishes, and in History afterwards — has **Save as Recipe**. Only steps the audit log recorded
as actually allowed are carried over, so blocked, denied and failed actions stay out of the recipe.

Each step keeps the element the action really landed on: its CSS selector, XPath, visible text
anchor, bounding box, tag and role. Tick **turn each typed value into a variable** and the values you
typed become `{{job_title}}`, `{{city}}`, `{{profile}}`; the recipe card renders a field per variable
pre-filled with the sample it was recorded with, so a replay starts one edit away.

**Replay is FAST by default**: for each step the recorded selector is resolved against the live page
(css → xpath → text anchor → bbox, and only if the element it finds still has the recorded tag and
role). A step that lands goes through the same risk scorer and approval gate as a live run. A step
that does not land is re-decided by the model — one nested agent task capped at four steps for that
one step only, never for the rest of the recipe. Scheduled runs cannot approve themselves, so a
recipe that reaches an approval in the background stops and reports instead of clicking through.

**Schedule** a recipe daily or weekly with a time, and `chrome.alarms` replays it in a background
window at the next slot. Chrome deletes every alarm when the extension reloads or updates, so the
library re-arms its own clocks on install and startup. A scheduled recipe has to contain a navigate
step — with nowhere to start, the run says so instead of replaying against a blank tab.

Recipes export and import as JSON, individually or the whole library at once. An import whose id
collides with an existing recipe gets a fresh id and floats to the top rather than overwriting
anything. Recorded selectors go to the audit log, never into the model transcript.

---

## Interaction and navigation tools

Ten verbs beyond click, type and scroll, so the agent can drive the widgets a real page actually
has (`src/tools/definitions.ts`):

| Tool | What it does |
| ------------ | -------------------------------------------------------------------- |
| `hover` | Sends real pointer and mouse events at an element — the way into dropdown menus. |
| `press_key` | `Enter`, `Escape`, `Tab`, or a combo like `ctrl+a`. With an index the key goes to that element, otherwise to the page. |
| `select_option` | Picks a `<select>` option by its visible text, falling back to its value, and fires `change`. |
| `check` | Ticks or unticks a checkbox — and refuses to untick a radio, which clears by itself. |
| `upload_file` | Attaches a document already stored in your vault to a file input. |
| `drag_and_drop` | A full `dragstart → dragenter → dragover → drop → dragend` sequence between two elements. |
| `go_back` / `go_forward` / `reload` | History, via the tab itself. |
| `open_tab` | Opens a new background tab and reports its index. |
| `wait_for` | Waits for `load`, a `selector`, some `text`, or `quiet` (500 ms with no DOM mutation) instead of guessing a sleep. |

Three limits worth knowing, because the agent is told about them rather than left to discover them:

- **`upload_file` can only attach what the vault already holds.** Chrome gives content scripts no
  disk access, so the file arrives as the stored document's text under its recorded name and MIME
  type. When a task needs a file that is not in the vault, the agent is instructed to ask you
  instead of pretending.
- **`wait_for` has no `network_idle`.** That would need the `webRequest` permission, which this
  extension deliberately does not request. `quiet` is the substitute: it waits for the page to stop
  changing.
- **A drag is scored against the element it lands on**, not the one it picks up — the damage happens
  at the drop target. That is also why drags are never saved into recipes: replay hands back one
  element index per step and a drag needs two.

Every new verb goes through the same risk scorer and approval gate as the old ones, and each has an
approval-card phrase you can read before allowing it (`attach "resume.pdf" to file input 2`,
`drag element 4 onto 9`). `node scripts/interaction-check.mjs` drives all of them against real
Chromium and asserts the page's own listeners fired — the menu opened, the `<select>` reported
`change`, the file input holds one file with the right name, size and type, and the card really
moved into the bin. The fixture (`fixtures/interaction.html`) is deliberately pure markup: page
behaviour is installed from the check via `page.evaluate`, because the CRXJS dev middleware rewrites
every `<script>` tag in a root-served HTML file into an empty inline-script module.

---

## Data and memory tools

Six tools that get information out of a page and keep it (`src/tools/dataTools.ts`):

| Tool | What it does |
| ------------ | -------------------------------------------------------------------- |
| `extract_structured` | Reads the current page and returns the fields you named, as one record or a list. A second, smaller model call does the reading; the page text is fenced as untrusted data first. |
| `screenshot` | Photographs the page as Chrome shows it and attaches the picture to that step in the timeline. |
| `write_file` | Writes text the agent composed (a summary, a CSV, a draft) into `Downloads/Navigator/`. |
| `download_file` | Saves a file from a URL into `Downloads/Navigator/`. Always asks you first. |
| `save_to_memory` | Keeps one short note — a preference, a fact it looked up, the shape of a site — for future tasks. |
| `recall_memory` | Finds those notes again by keyword before the agent asks you for the same thing twice. |

**Extraction says null when the page says nothing.** The prompt forbids guessing, and the parser
only keeps the keys that were asked for, drops nested values and marks `N/A` / "not stated" as
unknown, so the result is a set of holes rather than confident invention. Long pages are cut on a
line boundary and the tool reports how much fell off (`[page text cut after 14,001 of 40,220
characters]`) instead of pretending it read everything.

**A screenshot is for you, not for the model.** Every provider here sends text-only message content,
so the picture cannot travel back into the conversation; the tool says so in its own result, and the
image is stored on the audit row where the History tab can show it. Chrome's capture API also only
photographs the *visible* tab of a window, which is why the failure message tells the agent to
`switch_tab` first.

**Files never overwrite and never look executable.** Names are reduced to their last path segment
with control characters and reserved punctuation stripped, then placed under `Navigator/` inside
Downloads. `write_file` accepts text extensions only (`.txt`, `.md`, `.csv`, `.json`, `.yaml`,
`.ics`, …); `download_file` accepts documents, images, media and archives — and refuses `.exe`,
`.js`, `.html`, `.svg` and anything else that could run. Downloads are relative to the Downloads
folder by design, so the agent cannot write anywhere else. `download_file` is scored `high` because
the model chose a URL that puts bytes on your disk, and it is the one data tool recipes record:
"fetch this month's invoice" is a workflow, a screenshot is not.

**Memory is keyword recall, not embeddings.** `recall_memory` scores each note in the service
worker — tags ×3, note text ×2, source URL ×1, multiplied by how many of your words it matched, with
a small recency bonus — so a match is something the agent can be told the reason for, and no model
call or network round trip is needed to remember. Notes are capped at 600 characters and the library
at 500 rows, oldest dropped first; writing the same sentence twice refreshes the original instead of
filling the library with near-duplicates.

**Nothing secret belongs in memory.** `save_to_memory` refuses text that looks like a password,
card number, CVV, secret or one-time code, and the system prompt tells the agent to ask rather than
store; sensitive fields live in the encrypted vault. What it does keep is visible: the History tab
has a **Memory** card that lists every note with its tags, source site and age, searches them with
the same ranking the tool uses, and lets you delete one note or all of them.

---

## Command palette

`Ctrl+Shift+K` (`⌘+Shift+K` on a Mac) opens a palette over the whole panel — the keyboard path to
every part of Navigator (spec §10). The header's search icon and `Alt+1`…`Alt+6` are the other ways
around: `Alt+1` jumps to Agent, `Alt+2` Research, and so on to Settings. `Escape` closes the palette,
and when the palette is *not* open, `Escape` stops the running task — the kill switch never needs the
mouse.

**What is on the list** (`src/sidepanel/commands.ts`, fifteen commands in five groups):

| Group | Commands |
| ----- | -------- |
| Task | Run the task you wrote · Stop the running task · Write a new task |
| Mode | Switch to Observe / Co-pilot / Auto |
| Go to | Agent, Research, Tabs, Profiles, History, Settings |
| View | Toggle dark mode · Show or hide the element map on the page |
| Data | Export the audit log as JSON |

Matching is a small pure function (`src/commands/model.ts`): a hit in the title counts 3, a keyword 2,
a group name 1, multiplied by how much of what you typed it covered, plus a bonus when a word starts
the title. So `hist` lands on *Go to History* rather than *Export the audit log*, and the ranking is
unit-tested without a DOM.

**A command that can't run right now is still on the list, greyed, with the reason** — "Nothing is
running", "That is the current mode", "Write a task in the Agent tab first". Hiding them would make
the palette look like it had forgotten features; showing them teaches what exists and why this moment
isn't the time. `view.overlay` and `data.export-audit` are disabled outside a real Chrome tab, because
both talk to the page.

**Recipes are deliberately not runnable from the palette.** A replay can raise approval cards and
needs the bridge the History tab's recipe card owns; launching one from a context that cannot show
those cards would either silently skip approval or open a panel you are not looking at. Record and
replay them from History.

**If you typed a goal instead of a command**, the palette offers a synthetic first row —
`Start task: "find the cheapest 5kW monobloc"` — once the query is longer than a command would
normally be (6 characters). Pressing Enter on it puts that text in the task box and runs it. The
palette is a launcher, not a second parser.

**Reaching the shortcut when the panel is closed.** Chrome owns `Ctrl+Shift+K` through the manifest
`commands` key, which fires globally rather than inside the page. The service worker relays it to the
panel; if the side panel isn't open yet, Chrome may refuse to open it without a user gesture, so the
worker tries and the toolbar button stays as the guaranteed path.

**Screen-reader announcements.** Every mode of use here assumes the agent is acting on something you
cannot see, so the panel speaks as it works. A single always-mounted `role="status"` region reads the
most recent step ("Running: click Seat class."), because a live region added at the same moment as
its text is often ignored; the timeline is an ordered list with a label; approval and question cards
use `role="alert"` so they interrupt; the recent-activity cards became real buttons, reachable by Tab
and named ("Open the history of find heat pump grants"); and every interactive text box shows a focus
ring. The palette itself is the standard combobox/listbox pattern — focus stays in the input while
`aria-activedescendant` points at the highlighted row, so a reader announces the command before you
commit to it.

**Dark mode persists.** The choice is stored in `chrome.storage.local` (falling back to
`localStorage` when the panel runs outside Chrome), so a reload, a re-open or a different window all
come back in the theme you left.

---

## Auto mode site list

**Auto** mode is the mode that says "I'll do it myself", and the only promise it makes is on the sites
you have allowed. That list lives in Settings → Auto mode sites, in one row of the same IndexedDB
store as the model config: nothing is synced, and an empty list means Navigator asks before every
write, which is the safe direction to fail in.

| Piece | File | Job |
| ----- | ---- | --- |
| The rules | `src/safety/siteRules.ts` | normalise a host, decide whether a page is under an allowed or a blocked site |
| The storage | `src/safety/siteRulesStore.ts` | remember both lists between panel opens |
| The gate | `src/safety/modePolicy.ts` | turn mode + risk + site into allow, ask or block |
| The worker | `src/background/allowApi.ts` | write a rule asked for by an approval card |

**A rule is a host, not a URL.** Allowing `example.com` covers `shop.example.com`, whichever scheme the
page happens to use, because subdomains inherit the trust you gave the site. The port and the path are
left out on purpose: a promise about `example.com:8443` would be a promise about a server, not a site.
`evil-example.com` is not under `example.com`, so a lookalike host never slips through a suffix match.

**Reads and control tools are not gated.** Only a write action asks. A page that happens to be a
checkout page does not stop Navigator from reading it — the hard blocks (payment fields, passwords
being created, consent checkboxes, OTP, destructive confirmations, sensitive uploads) are about the
action, and they require your approval whatever the site list says.

**A run keeps the list it started with.** The worker reads the list once, when the task starts, so a
site you allow while a task is waiting for you takes effect on the next task. The confirmation on the
approval card says exactly that rather than leaving you to guess.

**"Allow `shop.test` in Auto mode"** appears on an approval card only when the site is the reason the
card is up. Approving a step and changing a standing rule are two decisions, so they stay two buttons.
The same list is reachable from the command palette (`allowlist`) and from
`corepack pnpm exec node scripts/allowlist-check.mjs`, which types into the real card, reloads the
panel and reads the stored rows back.

---

## End-to-end tests

`corepack pnpm test:e2e` runs the flows the spec names (§13.6), plus the Auto mode promise, against
the real built extension — real service worker, real content scripts, real IndexedDB, real Chrome tab
groups:

| Flow | What it proves |
| ---- | -------------------------------------------------------------- |
| Form fill | A task typed into the Agent tab fills the fixture job application from a vault profile, asks for approval first, and leaves the card, CV, password, OTP, consent and CAPTCHA fields untouched. The form is never submitted. |
| Research | A question becomes a plan, real background tabs, a scraped results page, ranked sources and a cited five-source answer. |
| Tab grouping | A sentence in the Tabs tab ends with Chrome itself holding the groups. |
| Auto mode list | Auto stops on an unlisted site, the one click on the card writes the rule, and the next task fills the same form without asking. |

Nothing reaches the internet. `e2e/mock-server.mjs` is the whole outside world: the form page, five
articles, a search results page and an OpenAI-compatible `/v1/chat/completions` that streams a fixed
script. The Settings tab is driven through the UI to point the extension at that endpoint, so the
provider layer, the SSE reader and the token accounting all run.

Two things about the harness are deliberate and easy to trip over:

- **Chrome for Testing, not your Chrome.** Since Chrome 137 the ordinary desktop build ignores
  `--load-extension`, so the run uses the Playwright-managed build:
  `corepack pnpm exec playwright install chromium` once, before the first run. `NAV_CHROME` points
  the run at a different binary and `NAV_E2E_HEADED=1` opens a visible window.
- **Each test gets a throw-away profile**, so vaults, settings and audit rows never leak from one
  flow into the next, and the side panel is opened as a plain tab
  (`chrome-extension://<id>/src/sidepanel/index.html`) because Playwright cannot open Chrome's side
  panel. The full panel UI renders there.

The search engine is stubbed inside the service worker rather than with Playwright routing: routing
only covers pages Playwright owns, and the research engine creates its own background tabs. The
five articles are served on five hostnames (`metering.heatpump.test` and friends, mapped to the
local mock by `--host-resolver-rules`) because the engine keeps at most two pages per domain — a
single-host corpus could never produce five sources.

The suite runs one worker at a time on purpose: an agent task follows the *active* tab, so two flows
in one browser would fight over it.

---

## Roadmap

| Batch | Scope                                                                  | Status |
| ----- | ---------------------------------------------------------------------- | ------ |
| 1     | Scaffold: Vite + CRXJS + React + TS strict + Tailwind, manifest, side panel shell, service worker, content script, typed message channel | done |
| 2     | Perception: interactive element map (DOM + shadow DOM + same-origin iframes), multi-strategy selectors, markdown extraction, 4000-token budget | done |
| 3     | LLM layer: provider abstraction, streaming tool calls, Dexie config store, Settings tab | done |
| 4     | Tools + safety: registry, executor, action queue, risk scorer, CDP fallback | done |
| 5     | Agent loop: planner/executor, loop detection, history compaction, kill switch | done |
| 6     | Side panel UX: live step timeline, approval cards, on-page element-map overlay, action highlight, History tab | done |
| 7     | Feature A: smart form filler + encrypted profile vault                  | done |
| 8     | Feature B: research engine                                              | done |
| 9     | Feature C: tab manager                                                  | done |
| 10    | Recipes, audit log, cost meter, Playwright E2E                          | done |
| 11a   | Interaction and navigation tools: hover, press_key, select_option, check, upload_file, drag_and_drop, history, open_tab, wait_for | done |
| 11b   | Data tools: structured extraction, screenshot, file output, long-term memory | done |
| 11c   | Command palette, keyboard-first navigation, screen-reader announcements | done |
| 12    | Auto mode site list: rules, storage, gate, Settings card, approval-card shortcut, palette entry, E2E | done |

## Safety model

Three autonomy modes — **Observe** (read-only), **Co-pilot** (approve each write action),
**Auto** (autonomous within your allowlist). Every action is risk-scored; high-risk actions
(submit, pay, delete, send, post) always require explicit approval. Auto mode goes one step further:
on a site you have not allowed it asks before every write, even a low-risk one
([the site list](#auto-mode-site-list)). Page text is treated as
untrusted data and wrapped so prompt-injection attempts in page content are logged and ignored,
never executed. Captchas and 2FA are never solved automatically — Navigator pauses and asks you.
