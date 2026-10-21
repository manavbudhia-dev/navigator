import { createDexieVault } from '@/memory/vault'
import { runVaultRequest } from '@/memory/vaultRequests'
import type { VaultRequest, VaultReply } from '@/types/vault'

/**
 * One vault, one handler. The service worker owns the only real instance —
 * the derived key lives in its memory and is gone when the worker sleeps.
 */

export const vault = createDexieVault()

export function handleVaultRequest(request: VaultRequest): Promise<VaultReply> {
  return runVaultRequest(vault, request)
}
