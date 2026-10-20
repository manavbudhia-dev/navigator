import { defineManifest } from '@crxjs/vite-plugin'

import pkg from '../package.json'

/**
 * Every permission below is required by a specific spec feature. Nothing here is
 * "nice to have" — removing one breaks a named capability.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Navigator',
  version: pkg.version,
  description: 'Autonomous browser agent: give it a goal in plain language and it drives the browser.',

  // Side panel is the primary UI. A popup would close on every page click.
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Open Navigator',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  permissions: [
    'sidePanel', // primary UI surface
    'storage', // model config, allowlists, audit log
    'tabs', // list_tabs/switch_tab/close_tabs + URL/title for page-state meta
    'tabGroups', // group_tabs tool + auto-grouping
    'activeTab', // act on the tab the user invoked us from
    'debugger', // CDP fallback input driver (React controlled inputs, canvas, iframes)
    'downloads', // download_file tool
    'alarms', // scheduled recipe replay
    'webNavigation', // load-state + network-idle detection for wait_for
  ],

  // The agent must operate on whatever site the user asks about, so broad host
  // access is unavoidable. Safety is enforced in-app by the domain
  // allowlist/blocklist + risk scorer, not by withholding permissions.
  host_permissions: ['<all_urls>'],
})
