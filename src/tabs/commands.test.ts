import { describe, expect, it } from 'vitest'

import { describeIntent, matchLabel, parseCommand, queryFromText } from './commands'
import { tab } from './testUtils'
import type { TabInfo } from './types'

const OPEN: TabInfo[] = [
  tab(1, { index: 0, url: 'https://youtube.com/watch?v=1', title: 'A video' }),
  tab(2, { index: 1, url: 'https://arxiv.org/abs/1706.03762', title: 'Attention paper' }),
  tab(3, { index: 2, url: 'https://acme.test/pricing', title: 'Pricing' }),
]

describe('parseCommand: the four examples from the spec', () => {
  it('reads "close all YouTube tabs"', () => {
    expect(parseCommand('close all YouTube tabs', OPEN)).toEqual({
      kind: 'close',
      match: { scope: 'host', host: 'youtube.com' },
    })
  })

  it('reads "group my work tabs"', () => {
    expect(parseCommand('group my work tabs', OPEN)).toEqual({
      kind: 'group',
      match: { scope: 'query', query: 'work' },
    })
  })

  it('reads "find the tab with the pricing page"', () => {
    expect(parseCommand('find the tab with the pricing page', OPEN)).toEqual({ kind: 'find', query: 'pricing' })
  })

  it('reads "save this session for tomorrow"', () => {
    expect(parseCommand('save this session for tomorrow', OPEN)).toEqual({
      kind: 'save',
      name: 'tomorrow',
      note: '',
      tags: [],
    })
  })
})

describe('parseCommand: scope', () => {
  it('knows the other tabs', () => {
    expect(parseCommand('close the other tabs', OPEN)).toEqual({ kind: 'close', match: { scope: 'others' } })
  })

  it('accepts a bare domain', () => {
    expect(parseCommand('close every reddit.com tab', OPEN)).toEqual({
      kind: 'close',
      match: { scope: 'host', host: 'reddit.com' },
    })
  })

  it('matches a site that is only open, not aliased', () => {
    expect(parseCommand('close the arxiv tabs', OPEN)).toEqual({
      kind: 'close',
      match: { scope: 'host', host: 'arxiv.org' },
    })
  })

  it('falls back to a topic query', () => {
    expect(parseCommand('close tabs about sourdough', OPEN)).toEqual({
      kind: 'close',
      match: { scope: 'query', query: 'sourdough' },
    })
  })
})

describe('parseCommand: every verb', () => {
  const cases: readonly (readonly [string, object])[] = [
    ['list my open tabs', { kind: 'list' }],
    ['ungroup everything', { kind: 'ungroup' }],
    ['merge duplicate tabs', { kind: 'merge' }],
    ['dedupe the window', { kind: 'merge' }],
    ['free up some memory', { kind: 'free' }],
    ['suspend the heaviest tabs to save ram', { kind: 'free' }],
    ['which tabs are stale', { kind: 'stale' }],
    ['index all pages', { kind: 'index' }],
    ['read every open page into the index', { kind: 'index' }],
    ['switch to the pricing page', { kind: 'switch' }],
    ['show me my saved sessions', { kind: 'sessions' }],
    ['undo that', { kind: 'undo' }],
    ['bring back the tabs I just closed', { kind: 'undo' }],
    ['restore yesterday’s session', { kind: 'restore' }],
  ]

  for (const [text, expected] of cases) {
    it(text, () => {
      expect(parseCommand(text, OPEN)).toMatchObject(expected)
    })
  }

  it('takes a day count for the sweeper', () => {
    expect(parseCommand('show tabs untouched for 30 days', OPEN)).toEqual({ kind: 'stale', days: 30 })
  })

  it('takes a tab budget for the memory saver', () => {
    expect(parseCommand('free memory, keep it under 12 tabs', OPEN)).toEqual({
      kind: 'free',
      match: { scope: 'all' },
      maxTabs: 12,
    })
  })

  it('names a session when the sentence does', () => {
    expect(parseCommand('save this session as "Kitchen quote"')).toMatchObject({ kind: 'save', name: 'Kitchen quote' })
    expect(parseCommand('save the window called research')).toMatchObject({ kind: 'save', name: 'research' })
  })

  it('returns null for a sentence it cannot read', () => {
    expect(parseCommand('sort out my browsing mess', OPEN)).toBeNull()
    expect(parseCommand('', OPEN)).toBeNull()
    expect(parseCommand('hello', OPEN)).toBeNull()
  })
})

describe('queryFromText', () => {
  it('drops verbs and filler but keeps the topic words', () => {
    expect(queryFromText('find the tab with the pricing page')).toBe('pricing')
    expect(queryFromText('close all of my open tabs')).toBe('')
  })
})

describe('report labels', () => {
  it('describes an intent in one line', () => {
    expect(describeIntent({ kind: 'close', match: { scope: 'host', host: 'youtube.com' } })).toBe('Close youtube.com tabs')
    expect(describeIntent({ kind: 'stale', days: 14 })).toBe('Tabs untouched for 14+ days')
    expect(describeIntent({ kind: 'find', query: 'pricing' })).toBe('Search tabs for "pricing"')
    expect(describeIntent({ kind: 'undo' })).toBe('Undo')
  })

  it('labels a selection', () => {
    expect(matchLabel({ scope: 'all' })).toBe('all tabs')
    expect(matchLabel({ scope: 'others' })).toBe('the other tabs')
    expect(matchLabel({ scope: 'query', query: 'work' })).toBe('tabs about "work"')
    expect(matchLabel({ scope: 'ids', ids: [1, 2] })).toBe('2 selected tabs')
    expect(matchLabel({ scope: 'ids', ids: [1] })).toBe('1 selected tab')
  })
})
