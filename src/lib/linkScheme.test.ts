import { describe, expect, it } from 'vitest'

import { isSafeHref } from './linkScheme'

describe('isSafeHref', () => {
  const base = 'https://jobs.example/listings'

  it('keeps the schemes a document can genuinely link to', () => {
    expect(isSafeHref('https://jobs.example/job/1', base)).toBe(true)
    expect(isSafeHref('http://example.test', base)).toBe(true)
    expect(isSafeHref('mailto:hr@example.test', base)).toBe(true)
    expect(isSafeHref('tel:+9122334455', base)).toBe(true)
  })

  it('keeps relative and same-page links, resolved against the page', () => {
    expect(isSafeHref('../job/2', base)).toBe(true)
    expect(isSafeHref('/job/3', base)).toBe(true)
    expect(isSafeHref('#details', base)).toBe(true)
  })

  it('drops the schemes that run code or reach into the machine', () => {
    expect(isSafeHref('javascript:alert(1)', base)).toBe(false)
    expect(isSafeHref('JaVaScRiPt:alert(1)', base)).toBe(false)
    expect(isSafeHref('data:text/html,<script>alert(1)</script>', base)).toBe(false)
    expect(isSafeHref('file:///C:/Users/manav/Downloads/contract.pdf', base)).toBe(false)
    expect(isSafeHref('blob:https://example.test/abc', base)).toBe(false)
  })

  it('drops an href with no target in it', () => {
    // A relative href with nothing to resolve it against is not a link the
    // panel can show safely, and an empty one points at the page you are on.
    expect(isSafeHref('/relative/without/a/base', undefined)).toBe(false)
    expect(isSafeHref('', base)).toBe(false)
    expect(isSafeHref('   ', base)).toBe(false)
  })

  it('treats an odd relative href as the same-site link it is', () => {
    expect(isSafeHref('not a url at all', base)).toBe(true)
  })

  it('reads a sloppy https href the way a browser would', () => {
    expect(isSafeHref('https:/example.test', base)).toBe(true)
  })
})
