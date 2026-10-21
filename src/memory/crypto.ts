/**
 * AES-GCM at rest, PBKDF2 from the user's passphrase (spec §6). 310k iterations
 * is the OWASP 2023 recommendation for PBKDF2-SHA256; the derived key is kept
 * in memory only and is lost when the MV3 worker is recycled.
 */

export const PBKDF2_ITERATIONS = 310_000

const webcrypto: Crypto = globalThis.crypto
const subtle: SubtleCrypto = webcrypto.subtle

export interface Envelope {
  cipher: string
  iv: string
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  webcrypto.getRandomValues(bytes)
  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Envelope> {
  const iv = randomBytes(12)
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const buffer = await subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, plain)
  return { cipher: toBase64(new Uint8Array(buffer)), iv: toBase64(iv) }
}

/** Throws when the key is wrong — GCM's auth tag makes a bad passphrase loud. */
export async function decryptJson<T>(key: CryptoKey, envelope: Envelope): Promise<T> {
  const buffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.cipher),
  )
  return JSON.parse(new TextDecoder().decode(buffer)) as T
}
