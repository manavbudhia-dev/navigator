/** True only inside a real extension context (side panel, popup, worker). */
export const inExtension: boolean =
  typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined' && !!chrome.runtime.id
