import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addSiteRule } from './siteApi'
import { loadAllowlist, loadBlocklist, saveAllowlist, saveBlocklist } from '@/safety/siteRulesStore'

vi.mock('@/safety/siteRulesStore', () => ({
  loadAllowlist: vi.fn<() => Promise<string[]>>(),
  saveAllowlist: vi.fn<(hosts: readonly string[]) => Promise<string[]>>(),
  loadBlocklist: vi.fn<() => Promise<string[]>>(),
  saveBlocklist: vi.fn<(hosts: readonly string[]) => Promise<string[]>>(),
}))

/**
 * The one message that changes a standing safety rule, so the two things the
 * panel depends on are pinned here: the list it is told back is what was
 * actually written, the rule lands on the list the card named, and junk never
 * becomes a rule at all.
 */
describe('addSiteRule', () => {
  beforeEach(() => {
    vi.mocked(loadAllowlist).mockReset().mockResolvedValue(['shop.test'])
    vi.mocked(saveAllowlist).mockReset().mockImplementation(async (hosts) => [...hosts].sort())
    vi.mocked(loadBlocklist).mockReset().mockResolvedValue(['bank.test'])
    vi.mocked(saveBlocklist).mockReset().mockImplementation(async (hosts) => [...hosts].sort())
  })

  it('keeps the sites already allowed', async () => {
    expect(await addSiteRule('allow', 'eu.other.test')).toEqual(['eu.other.test', 'shop.test'])
    expect(vi.mocked(saveAllowlist).mock.calls[0]![0]).toEqual(['eu.other.test', 'shop.test'])
  })

  it('stores the host, not the URL the card was holding', async () => {
    expect(await addSiteRule('allow', 'https://WWW.Shop.test/Checkout?x=1')).toEqual(['shop.test'])
    expect(vi.mocked(saveAllowlist).mock.calls[0]![0]).toEqual(['shop.test'])
  })

  it('writes a block to the blocked list and leaves the allowed sites alone', async () => {
    expect(await addSiteRule('block', 'evil.test')).toEqual(['bank.test', 'evil.test'])
    expect(vi.mocked(saveBlocklist).mock.calls[0]![0]).toEqual(['bank.test', 'evil.test'])
    expect(saveAllowlist).not.toHaveBeenCalled()
  })

  it('refuses a value that is not a site', async () => {
    await expect(addSiteRule('block', 'not a host')).rejects.toThrow(/site address/i)
    expect(saveBlocklist).not.toHaveBeenCalled()
  })
})
