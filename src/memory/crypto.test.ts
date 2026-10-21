// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  PBKDF2_ITERATIONS,
  decryptJson,
  deriveKey,
  encryptJson,
  fromBase64,
  randomBytes,
  toBase64,
} from './crypto'

/** The 310k-round key derivation is slow, so these tests derive once and share. */
const salt = randomBytes(16)
const keyPromise = deriveKey('correct horse battery', salt, 2000)

describe('vault crypto', () => {
  it('uses the OWASP PBKDF2 iteration floor', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(310_000)
  })

  it('round-trips base64 through arbitrary bytes', () => {
    const bytes = randomBytes(64)
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips a JSON value through AES-GCM', async () => {
    const key = await keyPromise
    const value = { name: 'Manav', scores: [1, 2, 3], nested: { ok: true } }
    const envelope = await encryptJson(key, value)
    expect(envelope.cipher).not.toContain('Manav')
    expect(await decryptJson<typeof value>(key, envelope)).toEqual(value)
  })

  it('uses a fresh IV per encryption', async () => {
    const key = await keyPromise
    const a = await encryptJson(key, { v: 1 })
    const b = await encryptJson(key, { v: 1 })
    expect(a.iv).not.toBe(b.iv)
    expect(a.cipher).not.toBe(b.cipher)
  })

  it('refuses to decrypt with a key from another passphrase', async () => {
    const key = await keyPromise
    const wrong = await deriveKey('wrong horse battery', salt, 2000)
    const envelope = await encryptJson(key, { secret: 'a' })
    await expect(decryptJson(wrong, envelope)).rejects.toThrow()
  })

  it('derives the same key for the same passphrase and salt', async () => {
    const one = await deriveKey('shared passphrase', salt, 2000)
    const two = await deriveKey('shared passphrase', salt, 2000)
    const envelope = await encryptJson(one, { hi: 'there' })
    expect(await decryptJson(two, envelope)).toEqual({ hi: 'there' })
  })
})
