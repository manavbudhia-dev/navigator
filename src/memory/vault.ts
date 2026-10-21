import { db, type VaultRow } from './db'
import {
  decryptJson,
  deriveKey,
  encryptJson,
  fromBase64,
  randomBytes,
  toBase64,
  type Envelope,
} from './crypto'
import { ProfileSchema, countFilled, type Profile, type ProfileMeta } from '@/types/vault'

/**
 * The profile vault (spec §6). Storage is injected so the crypto and the
 * locking rules are testable without IndexedDB; the derived key never leaves
 * this object and is dropped on lock() (or when the worker is recycled).
 */

const SALT_KEY = 'vault-salt'
const CHECK_KEY = 'vault-check'

export interface VaultStore {
  getRow(id: string): Promise<VaultRow | undefined>
  allRows(): Promise<VaultRow[]>
  putRow(row: VaultRow): Promise<void>
  deleteRow(id: string): Promise<void>
  getMeta(key: string): Promise<string | undefined>
  setMeta(key: string, value: string): Promise<void>
}

export class Vault {
  private key: CryptoKey | null = null
  private salt: string | null | undefined

  constructor(
    private readonly store: VaultStore,
    private readonly derive: typeof deriveKey = deriveKey,
  ) {}

  private async saltOrNull(): Promise<string | null> {
    if (this.salt === undefined) this.salt = (await this.store.getMeta(SALT_KEY)) ?? null
    return this.salt
  }

  get isUnlocked(): boolean {
    return this.key !== null
  }

  async status(): Promise<'no-vault' | 'locked' | 'unlocked'> {
    if (this.key) return 'unlocked'
    return (await this.saltOrNull()) === null ? 'no-vault' : 'locked'
  }

  /** First run only: picks a fresh salt and proves the passphrase round-trips. */
  async create(passphrase: string): Promise<void> {
    if (passphrase.length < 8) throw new Error('Use at least 8 characters for the vault passphrase.')
    if ((await this.saltOrNull()) !== null) throw new Error('A vault already exists — unlock it instead.')
    const salt = randomBytes(16)
    const key = await this.derive(passphrase, salt)
    const check = await encryptJson(key, { ok: true })
    await this.store.setMeta(SALT_KEY, toBase64(salt))
    await this.store.setMeta(CHECK_KEY, JSON.stringify(check))
    this.salt = toBase64(salt)
    this.key = key
  }

  async unlock(passphrase: string): Promise<void> {
    const salt = await this.saltOrNull()
    const raw = salt ? await this.store.getMeta(CHECK_KEY) : undefined
    if (!salt || !raw) throw new Error('No vault exists yet.')
    const key = await this.derive(passphrase, fromBase64(salt))
    try {
      await decryptJson<{ ok: boolean }>(key, JSON.parse(raw) as Envelope)
    } catch {
      throw new Error('Wrong passphrase.')
    }
    this.key = key
  }

  lock(): void {
    this.key = null
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new Error('The profile vault is locked.')
    return this.key
  }

  async list(): Promise<ProfileMeta[]> {
    const key = this.requireKey()
    const rows = await this.store.allRows()
    const profiles: ProfileMeta[] = []
    for (const row of rows) {
      const profile = await this.decode(key, row)
      if (!profile) continue
      profiles.push({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        updatedAt: profile.updatedAt,
        filled: countFilled(profile),
      })
    }
    return profiles.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Profile | null> {
    const key = this.requireKey()
    const row = await this.store.getRow(id)
    return row ? this.decode(key, row) : null
  }

  async save(profile: Profile): Promise<void> {
    const key = this.requireKey()
    const clean = ProfileSchema.parse(profile)
    const envelope = await encryptJson(key, clean)
    await this.store.putRow({ id: clean.id, updatedAt: clean.updatedAt || Date.now(), ...envelope })
  }

  async remove(id: string): Promise<void> {
    this.requireKey()
    await this.store.deleteRow(id)
  }

  private async decode(key: CryptoKey, row: VaultRow): Promise<Profile | null> {
    try {
      return ProfileSchema.parse(await decryptJson<unknown>(key, { cipher: row.cipher, iv: row.iv }))
    } catch {
      // A row written by an older schema version stays readable-by-skip: the
      // vault must never make the whole list disappear because one profile moved on.
      return null
    }
  }
}

/** Dexie-backed vault shared by the service worker and (in dev) the panel. */
export function createDexieVault(): Vault {
  return new Vault({
    async getRow(id) {
      return db.vault.get(id)
    },
    async allRows() {
      return db.vault.toArray()
    },
    async putRow(row) {
      await db.vault.put(row)
    },
    async deleteRow(id) {
      await db.vault.delete(id)
    },
    async getMeta(key) {
      return (await db.settings.get(key))?.value as string | undefined
    },
    async setMeta(key, value) {
      await db.settings.put({ key, value })
    },
  })
}
