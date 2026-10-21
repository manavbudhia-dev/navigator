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
node scripts/screenshot.mjs    # headless-Chrome screenshot of the side panel (needs `pnpm dev` running)
node scripts/perception-check.mjs  # runs the perception layer on a fixture page in headless Chrome (needs `pnpm dev`)
node scripts/actions-check.mjs     # runs the action executor (click/type/select/scroll) on the fixture (needs `pnpm dev`)
node scripts/overlay-check.mjs     # renders the on-page element map + action highlight in headless Chrome (needs `pnpm dev`)
node scripts/history-shot.mjs      # seeds the audit log and screenshots the History + Agent tabs (needs `pnpm dev`)
node scripts/form-check.mjs        # classifies + fills the fixture form end to end in headless Chrome, then asserts the blocked fields stayed empty (needs `pnpm dev`)
node scripts/profiles-shot.mjs     # walks the Profiles tab: create vault, edit profile, lock, unlock, and screenshots each state (needs `pnpm dev`)
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
  types/             shared, typed message contracts between the three contexts
  lib/               framework-agnostic helpers
  styles/            Tailwind entry point + design tokens
```

Later batches add `agent/` (planner + executor loop), `llm/` (provider abstraction),
`tools/` (registry + executor), `memory/` (Dexie + crypto + profile vault), `safety/` (risk scorer,
guard), `prompts/` (system prompt templates), `forms/` (field classifier + fill planner),
`research/` and `tabs/` (research engine, tab manager).

## Permissions — why each one

| Permission        | Needed for                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `sidePanel`       | Primary UI surface                                                          |
| `storage`         | Model config, domain allowlist/blocklist, audit log                         |
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
| 8     | Feature B: research engine                                              | next |
| 9     | Feature C: tab manager                                                  | — |
| 10    | Recipes, audit log, cost meter, Playwright E2E                          | — |

## Safety model

Three autonomy modes — **Observe** (read-only), **Co-pilot** (approve each write action),
**Auto** (autonomous within your allowlist). Every action is risk-scored; high-risk actions
(submit, pay, delete, send, post) always require explicit approval. Page text is treated as
untrusted data and wrapped so prompt-injection attempts in page content are logged and ignored,
never executed. Captchas and 2FA are never solved automatically — Navigator pauses and asks you.
