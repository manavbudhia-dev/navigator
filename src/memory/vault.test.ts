// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'

import { Vault, type VaultStore } from './vault'
import { deriveKey } from './crypto'
import { emptyProfile } from '@/types/vault'
import type { VaultRow } from './db'

/** Fast derivation so the suite stays a second long; the real vault uses 310k. */
const fastDerive: typeof deriveKey = (passphrase, salt, _iterations) =>
  deriveKey(passphrase, salt, 2000)

function memoryStore(): VaultStore & { rows: Map<string, VaultRow>; meta: Map<string, string> } {
  const rows = new Map<string, VaultRow>()
  const meta = new Map<string, string>()
  return {
    rows,
    meta,
    async getRow(id) {
      return rows.get(id)
    },
    async allRows() {
      return [...rows.values()]
    },
    async putRow(row) {
      rows.set(row.id, row)
    },
    async deleteRow(id) {
      rows.delete(id)
    },
    async getMeta(key) {
      return meta.get(key)
    },
    async setMeta(key, value) {
      meta.set(key, value)
    },
  }
}

function profileWith(name: string, email: string) {
  const profile = emptyProfile(`p-${name.toLowerCase()}`, name)
  profile.contact.email = email
  profile.identity.firstName = name
  return profile
}

describe('Vault', () => {
  let store: ReturnType<typeof memoryStore>
  let vault: Vault

  beforeEach(() => {
    store = memoryStore()
    vault = new Vault(store, fastDerive)
  })

  it('starts with no vault and refuses to read before creation', async () => {
    expect(await vault.status()).toBe('no-vault')
    expect(vault.isUnlocked).toBe(false)
    await expect(vault.list()).rejects.toThrow('locked')
  })

  it('rejects a short passphrase and a second vault', async () => {
    await expect(vault.create('short')).rejects.toThrow('8 characters')
    await vault.create('a long enough passphrase')
    await expect(vault.create('another long one')).rejects.toThrow('already exists')
  })

  it('unlocks only with the right passphrase and locks again on demand', async () => {
    await vault.create('a long enough passphrase')
    vault.lock()
    expect(await vault.status()).toBe('locked')

    await expect(vault.unlock('not the passphrase')).rejects.toThrow('Wrong passphrase.')
    expect(vault.isUnlocked).toBe(false)

    await vault.unlock('a long enough passphrase')
    expect(vault.isUnlocked).toBe(true)
  })

  it('stores profiles encrypted: the plaintext never reaches the row', async () => {
    await vault.create('a long enough passphrase')
    await vault.save(profileWith('Manav', 'manav@example.com'))

    const row = store.rows.get('p-manav')
    expect(row).toBeDefined()
    expect(row?.cipher).not.toContain('manav@example.com')
    expect(JSON.stringify([...store.rows.values()])).not.toContain('Manav')
  })

  it('lists metadata newest-first and round-trips a saved profile', async () => {
    await vault.create('a long enough passphrase')
    const first = profileWith('First', 'first@example.com')
    first.updatedAt = 1000
    const second = profileWith('Second', 'second@example.com')
    second.updatedAt = 2000
    await vault.save(first)
    await vault.save(second)

    const list = await vault.list()
    expect(list.map((p) => p.name)).toEqual(['Second', 'First'])
    expect(list[0]?.filled).toBe(2)

    const loaded = await vault.get('p-first')
    expect(loaded?.contact.email).toBe('first@example.com')
  })

  it('drops a row that no longer matches the profile schema instead of failing the list', async () => {
    await vault.create('a long enough passphrase')
    await vault.save(profileWith('Good', 'good@example.com'))
    store.rows.set('broken', {
      id: 'broken',
      updatedAt: 5,
      cipher: 'AA==',
      iv: 'AA==',
    })

    const list = await vault.list()
    expect(list.map((p) => p.name)).toEqual(['Good'])
    expect(await vault.get('broken')).toBeNull()
  })

  it('removes a profile and returns null for a missing id', async () => {
    await vault.create('a long enough passphrase')
    await vault.save(profileWith('Manav', 'manav@example.com'))
    await vault.remove('p-manav')
    expect(await vault.get('p-manav')).toBeNull()
    expect(await vault.list()).toEqual([])
  })

  it('re-encrypts on save rather than keeping the old ciphertext', async () => {
    await vault.create('a long enough passphrase')
    const profile = profileWith('Manav', 'old@example.com')
    await vault.save(profile)
    const before = store.rows.get('p-manav')?.cipher
    profile.contact.email = 'new@example.com'
    await vault.save(profile)
    expect(store.rows.get('p-manav')?.cipher).not.toBe(before)
    expect((await vault.get('p-manav'))?.contact.email).toBe('new@example.com')
  })
})
