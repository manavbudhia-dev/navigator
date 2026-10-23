/**
 * Auto mode's site list (spec §9): "acts alone on allowlisted sites".
 * Two files because the rules are cheap to test and the storage is not —
 * `allowlist.ts` decides, `allowlistStore.ts` remembers.
 *
 * A rule is a host, not a full URL: you trust `example.com`, and everything
 * under it (`shop.example.com`) inherits that trust, whichever scheme the page
 * happens to use.
 */

/** A page's host plus whether the user has allowed it. `''` means "not a real page". */
export interface SiteContext {
  host: string
  allowlisted: boolean
}

/** Strip the scheme, the path and a leading `www.`; lowercase the rest. */
export function normalizeHost(value: string): string {
  const raw = value.trim().toLowerCase()
  if (raw === '') return ''
  let candidate = raw
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return ''
  }
  if (url.hostname === '') return ''
  return url.hostname.replace(/^www\./, '')
}

/** The host an action belongs to, from the page URL. Empty for non-web schemes. */
export function hostOf(url: string | null | undefined): string {
  if (typeof url !== 'string') return ''
  const raw = url.trim().toLowerCase()
  if (raw === '') return ''
  if (!/^https?:\/\//.test(raw)) return ''
  return normalizeHost(raw)
}

/** Is `host` the rule itself or something beneath it? */
export function isAllowlisted(host: string, rules: readonly string[]): boolean {
  if (host === '') return false
  return rules.some((rule) => {
    const allowed = normalizeHost(rule)
    if (allowed === '') return false
    return host === allowed || host.endsWith(`.${allowed}`)
  })
}

/** The gate as the policy sees it: the page an action happens on, already judged. */
export function siteFor(url: string | null | undefined, rules: readonly string[]): SiteContext {
  const host = hostOf(url)
  return { host, allowlisted: isAllowlisted(host, rules) }
}

/** Add a rule, keeping the list normalized, unique and alphabetical. */
export function addRule(rules: readonly string[], value: string): string[] {
  const host = normalizeHost(value)
  if (host === '') return [...rules]
  return [...new Set([...rules.map((rule) => normalizeHost(rule)).filter((rule) => rule !== ''), host])].sort()
}

/** Remove the rule that covers this host, exactly rather than by prefix. */
export function removeRule(rules: readonly string[], value: string): string[] {
  const host = normalizeHost(value)
  return rules.filter((rule) => normalizeHost(rule) !== host)
}

/** How the list is described to the user when it is empty. */
export const EMPTY_ALLOWLIST_HINT =
  'No sites yet. In Auto mode Navigator asks before every write until you allow a site here.'
