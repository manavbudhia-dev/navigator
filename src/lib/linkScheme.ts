/**
 * Which links a page is allowed to hand to the model, the timeline, or the
 * user's cursor. A blacklist has to be updated every time a new scheme turns
 * up; an allowlist only has to name the handful that a document can genuinely
 * link to. `javascript:` and `data:` both execute whatever the page wrote, and
 * a `file:` link is a finger on the user's own disk.
 */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isSafeHref(href: string, baseUrl?: string): boolean {
  // An empty href resolves to the page you are already on, which the URL
  // parser happily reports as a safe https link. It is not a link.
  if (href.trim() === '') return false
  try {
    return SAFE_LINK_SCHEMES.has(new URL(href, baseUrl).protocol)
  } catch {
    return false
  }
}
