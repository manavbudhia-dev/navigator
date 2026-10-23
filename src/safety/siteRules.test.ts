import { describe, expect, it } from 'vitest'

import { addRule, hostOf, hostMatchesRules, normalizeHost, removeRule, siteFor } from './siteRules'

describe('normalizeHost', () => {
  it('reduces a pasted URL to the host the rule is about', () => {
    expect(normalizeHost('https://www.Shop.Example.COM/cart?ref=1')).toBe('shop.example.com')
    expect(normalizeHost('example.com')).toBe('example.com')
    // A site is its host: the port and the path are not part of the promise.
    expect(normalizeHost('  http://example.com:8443/x  ')).toBe('example.com')
  })

  it('has nothing to say about an empty or unusable value', () => {
    expect(normalizeHost('')).toBe('')
    expect(normalizeHost('   ')).toBe('')
    expect(normalizeHost('http://')).toBe('')
    // A host with a space in it is two words, not a site. Chrome's URL parser
    // would answer `not%20a%20host`, so the refusal is made here instead.
    expect(normalizeHost('not a host')).toBe('')
    expect(normalizeHost('shop.test evil.test')).toBe('')
  })
})

describe('hostOf', () => {
  it('names the host of a web page', () => {
    expect(hostOf('https://shop.test/checkout')).toBe('shop.test')
    expect(hostOf('http://localhost:5173/')).toBe('localhost')
  })

  it('refuses the pages Chrome owns and the ones that are not pages', () => {
    expect(hostOf('chrome://new-tab-page/')).toBe('')
    expect(hostOf('javascript:alert(1)')).toBe('')
    expect(hostOf('about:blank')).toBe('')
    expect(hostOf('')).toBe('')
    expect(hostOf(null)).toBe('')
    expect(hostOf(undefined)).toBe('')
  })
})

describe('hostMatchesRules', () => {
  it('lets a rule cover the site itself and anything beneath it', () => {
    expect(hostMatchesRules('example.com', ['example.com'])).toBe(true)
    expect(hostMatchesRules('shop.example.com', ['example.com'])).toBe(true)
    expect(hostMatchesRules('a.b.example.com', ['example.com'])).toBe(true)
  })

  it('does not let a lookalike borrow another site’s rule', () => {
    expect(hostMatchesRules('evil-example.com', ['example.com'])).toBe(false)
    expect(hostMatchesRules('notexample.com', ['example.com'])).toBe(false)
    expect(hostMatchesRules('example.com.evil.test', ['example.com'])).toBe(false)
  })

  it('ignores a www it was never asked about and any rule that is not a host', () => {
    expect(hostMatchesRules('shop.example.com', [' EXAMPLE.com '])).toBe(true)
    expect(hostMatchesRules('shop.test', [])).toBe(false)
    expect(hostMatchesRules('shop.test', ['http://'])).toBe(false)
    expect(hostMatchesRules('', ['example.com'])).toBe(false)
  })
})

describe('siteFor', () => {
  it('judges the page an action happens on', () => {
    expect(siteFor('https://shop.test/checkout', ['shop.test'])).toEqual({
      host: 'shop.test',
      allowlisted: true,
      blocked: false,
    })
    expect(siteFor('https://other.test/checkout', ['shop.test'])).toEqual({
      host: 'other.test',
      allowlisted: false,
      blocked: false,
    })
    expect(siteFor(undefined, ['shop.test'])).toEqual({ host: '', allowlisted: false, blocked: false })
  })

  it('marks a page blocked when a block rule covers its host', () => {
    expect(siteFor('https://bank.test/accounts', [], ['bank.test'])).toEqual({
      host: 'bank.test',
      allowlisted: false,
      blocked: true,
    })
    expect(siteFor('https://a.bank.test/', [], ['bank.test'])).toEqual({
      host: 'a.bank.test',
      allowlisted: false,
      blocked: true,
    })
  })

  it('lets a blocked site be both, so a stale allow cannot hide the block', () => {
    expect(siteFor('https://bank.test/', ['bank.test'], ['bank.test'])).toEqual({
      host: 'bank.test',
      allowlisted: true,
      blocked: true,
    })
  })

  it('ignores a block rule that is not a host', () => {
    expect(siteFor('https://shop.test/', ['shop.test'], ['http://', ''])).toEqual({
      host: 'shop.test',
      allowlisted: true,
      blocked: false,
    })
  })
})

describe('addRule and removeRule', () => {
  it('keeps the list normalized, unique and in order', () => {
    expect(addRule(['shop.test'], 'https://www.Shop.test/login')).toEqual(['shop.test'])
    expect(addRule(['shop.test'], 'zebra.test')).toEqual(['shop.test', 'zebra.test'])
  })

  it('leaves the list alone when the value is not a host', () => {
    expect(addRule(['shop.test'], 'http://')).toEqual(['shop.test'])
  })

  it('removes the rule however the user spells it', () => {
    expect(removeRule(['shop.test', 'zebra.test'], 'WWW.SHOP.test')).toEqual(['zebra.test'])
    expect(removeRule(['shop.test'], 'other.test')).toEqual(['shop.test'])
  })
})
