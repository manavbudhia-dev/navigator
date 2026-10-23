import { beforeEach, describe, expect, it, vi } from 'vitest'

import { allowSite } from './allowApi'
import { loadAllowlist, saveAllowlist } from '@/safety/siteRulesStore'

vi.mock('@/safety/siteRulesStore', () => ({
  loadAllowlist: vi.fn<() => Promise<string[]>>(),
  saveAllowlist: vi.fn<(hosts: readonly string[]) => Promise<string[]>>(),
  loadBlocklist: vi.fn<() => Promise<string[]>>(),
  saveBlocklist: vi.fn<(hosts: readonly string[]) => Promise<string[]>>(),
}))

/**
 * The one message that changes a standing safety rule, so the two things the
 * panel depends on are pinned here: the list it is told back is what was
 * actually written, and junk never becomes a rule.
 */
describe('allowSite', () => {
  beforeEach(() => {
    vi.mocked(loadAllowlist).mockReset().mockResolvedValue(['shop.test'])
    vi.mocked(saveAllowlist).mockReset().mockImplementation(async (hosts) => [...hosts].sort())
  })

  it('keeps the sites already allowed', async () => {
    expect(await allowSite('eu.other.test')).toEqual(['eu.other.test', 'shop.test'])
    expect(vi.mocked(saveAllowlist).mock.calls[0]![0]).toEqual(['eu.other.test', 'shop.test'])
  })

  it('stores the host, not the URL the card was holding', async () => {
    expect(await allowSite('https://WWW.Shop.test/Checkout?x=1')).toEqual(['shop.test'])
    expect(vi.mocked(saveAllowlist).mock.calls[0]![0]).toEqual(['shop.test'])
  })

  it('refuses a value that is not a site', async () => {
    await expect(allowSite('not a host')).rejects.toThrow(/site address/i)
    expect(saveAllowlist).not.toHaveBeenCalled()
  })
})
