// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { runVaultRequest } from './vaultRequests'
import { Vault, type VaultStore } from './vault'
import { deriveKey } from './crypto'
import type { VaultRow } from './db'

const fastDerive: typeof deriveKey = (passphrase, salt) => deriveKey(passphrase, salt, 2000)

function vaultWithMemory(): { vault: Vault; rows: Map<string, VaultRow> } {
  const rows = new Map<string, VaultRow>()
  const meta = new Map<string, string>()
  const store: VaultStore = {
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
  return { vault: new Vault(store, fastDerive), rows }
}

describe('runVaultRequest', () => {
  it('reports every reply with the current status so one round trip is enough', async () => {
    const { vault } = vaultWithMemory()
    const created = await runVaultRequest(vault, { action: 'create', passphrase: 'a long passphrase' })
    expect(created).toMatchObject({ ok: true, status: 'unlocked', profiles: [] })
  })

  it('creates a profile through `new` and returns it decrypted for editing', async () => {
    const { vault } = vaultWithMemory()
    await runVaultRequest(vault, { action: 'create', passphrase: 'a long passphrase' })
    const reply = await runVaultRequest(vault, { action: 'new', name: 'Personal', kind: 'personal' })
    expect(reply.ok).toBe(true)
    expect(reply.profile?.name).toBe('Personal')
    expect(reply.profiles?.map((p) => p.name)).toEqual(['Personal'])

    const opened = await runVaultRequest(vault, { action: 'get', id: reply.profile!.id })
    expect(opened.profile?.id).toBe(reply.profile!.id)
  })

  it('turns a lock into an empty list and a failed unlock into an error message', async () => {
    const { vault } = vaultWithMemory()
    await runVaultRequest(vault, { action: 'create', passphrase: 'a long passphrase' })
    expect((await runVaultRequest(vault, { action: 'lock' })).status).toBe('locked')
    expect((await runVaultRequest(vault, { action: 'list' })).profiles).toEqual([])

    const bad = await runVaultRequest(vault, { action: 'unlock', passphrase: 'the wrong passphrase' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('Wrong passphrase.')
  })

  it('refuses to save while locked instead of throwing at the caller', async () => {
    const { vault } = vaultWithMemory()
    const reply = await runVaultRequest(vault, {
      action: 'save',
      profile: { id: 'x', name: 'X', kind: 'personal', updatedAt: 1 } as never,
    })
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('locked')
  })
})
