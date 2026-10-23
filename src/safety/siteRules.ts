/**
 * The site lists the safety gate reads (spec §9): the hosts Auto mode may act
 * on alone, and the hosts Navigator never acts on. Two files because the rules
 * are cheap to test and the storage is not — `siteRules.ts` decides,
 * `siteRulesStore.ts` remembers.
 *
 * A rule is a host, not a full URL: you judge `example.com`, and everything
 * under it (`shop.example.com`) inherits that judgement, whichever scheme the
 * page happens to use.
 */

/** A page's host plus how both lists judge it. `''` means "not a real page". */
export interface SiteContext {
  host: string
  allowlisted: boolean
  blocked: boolean
}

/** Strip the scheme, the path and a leading `www.`; lowercase the rest. */
export function normalizeHost(value: string): string {
  const raw = value.trim().toLowerCase()
  // Refused here rather than left to the URL parser: a host cannot contain a
  // space, and Chrome's parser answers `%20a%20host` where Node's answers
  // "invalid", so the two engines would disagree about what is a rule.
  if (raw === '' || /\s/.test(raw)) return ''
  let candidate = raw
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return ''
  }
  if (url.hostname === '' || url.hostname.includes('%')) return ''
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

/**
 * Is `host` the rule itself or something beneath it? One matcher for both
 * lists: a block is written the same way as an allow, so it must also widen
 * the same way.
 */
export function hostMatchesRules(host: string, rules: readonly string[]): boolean {
  if (host === '') return false
  return rules.some((rule) => {
    const named = normalizeHost(rule)
    if (named === '') return false
    return host === named || host.endsWith(`.${named}`)
  })
}

/** The gate as the policy sees it: the page an action happens on, already judged. */
export function siteFor(
  url: string | null | undefined,
  allowRules: readonly string[],
  blockRules: readonly string[] = [],
): SiteContext {
  const host = hostOf(url)
  return {
    host,
    allowlisted: hostMatchesRules(host, allowRules),
    blocked: hostMatchesRules(host, blockRules),
  }
}

/** Is this page on a site the user closed? Reads count, so research asks here too. */
export function isBlocked(url: string | null | undefined, blockRules: readonly string[]): boolean {
  return hostMatchesRules(hostOf(url), blockRules)
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

/** How each list is described to the user when it is empty. */
export const EMPTY_ALLOWLIST_HINT =
  'No sites yet. In Auto mode Navigator asks before every write until you allow a site here.'

export const EMPTY_BLOCKLIST_HINT =
  'No blocked sites. Add one and Navigator refuses to read or write there in any mode.'
