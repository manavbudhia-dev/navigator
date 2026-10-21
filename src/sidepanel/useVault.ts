import { useCallback, useEffect, useRef, useState } from 'react'

import { createDexieVault, type Vault } from '@/memory/vault'
import { runVaultRequest } from '@/memory/vaultRequests'
import { inExtension } from '@/lib/extension'
import type { BackgroundResponse } from '@/types/messages'
import type { Profile, ProfileMeta, VaultRequest, VaultReply, VaultStatus } from '@/types/vault'

/**
 * The panel talks to the vault through messages so the passphrase and the
 * derived key stay in the service worker. Outside the extension (plain dev
 * page) there is no worker, so the panel keeps a local instance instead.
 */

let devVault: Vault | null = null

async function sendRequest(request: VaultRequest): Promise<VaultReply> {
  if (inExtension) {
    const response = (await chrome.runtime.sendMessage({ kind: 'vault', request })) as BackgroundResponse
    if ('vault' in response) return response.vault
    if ('error' in response && typeof response.error === 'string') {
      return { ok: false, error: response.error }
    }
    return { ok: false, error: 'The service worker did not answer.' }
  }

  devVault ??= createDexieVault()
  return runVaultRequest(devVault, request)
}

export interface VaultState {
  status: VaultStatus
  profiles: ProfileMeta[]
  error: string | null
  busy: boolean
  call(request: VaultRequest): Promise<VaultReply>
  open(id: string): Promise<Profile | null>
}

export function useVault(): VaultState {
  const [status, setStatus] = useState<VaultStatus>('locked')
  const [profiles, setProfiles] = useState<ProfileMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const call = useCallback(async (request: VaultRequest): Promise<VaultReply> => {
    setBusy(true)
    setError(null)
    try {
      const reply = await sendRequest(request)
      if (!mounted.current) return reply
      if (reply.ok) {
        if (reply.status) setStatus(reply.status)
        if (reply.profiles) setProfiles(reply.profiles)
        if (reply.status === 'locked' || reply.status === 'no-vault') setProfiles([])
      } else if (reply.error) {
        setError(reply.error)
      }
      return reply
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mounted.current) setError(message)
      return { ok: false, error: message }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const open = useCallback(
    async (id: string): Promise<Profile | null> => {
      const reply = await call({ action: 'get', id })
      return reply.ok ? (reply.profile ?? null) : null
    },
    [call],
  )

  useEffect(() => {
    void call({ action: 'status' })
  }, [call])

  return { status, profiles, error, busy, call, open }
}
