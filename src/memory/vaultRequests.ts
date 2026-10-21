import { emptyProfile, type Profile, type VaultReply, type VaultRequest } from '@/types/vault'
import type { Vault } from './vault'

/**
 * The vault request handler, shared by the service worker (through messages)
 * and the dev-preview panel (through a local instance). Every successful call
 * returns the fresh status plus the profile list so the UI needs one round trip.
 */

export function newProfileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}`
}

async function reply(vault: Vault, extra: { profile?: Profile | null } = {}): Promise<VaultReply> {
  const status = await vault.status()
  return {
    ok: true,
    status,
    profiles: status === 'unlocked' ? await vault.list() : [],
    ...extra,
  }
}

export async function runVaultRequest(vault: Vault, request: VaultRequest): Promise<VaultReply> {
  try {
    switch (request.action) {
      case 'create':
        await vault.create(request.passphrase)
        break
      case 'unlock':
        await vault.unlock(request.passphrase)
        break
      case 'lock':
        vault.lock()
        break
      case 'save':
        await vault.save(request.profile)
        break
      case 'delete':
        await vault.remove(request.id)
        break
      case 'new': {
        const profile = emptyProfile(newProfileId(), request.name, request.kind)
        await vault.save(profile)
        return reply(vault, { profile })
      }
      case 'get':
        return reply(vault, { profile: await vault.get(request.id) })
      case 'list':
      case 'status':
        return reply(vault)
    }
    return reply(vault)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
