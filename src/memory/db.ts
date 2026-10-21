import Dexie, { type Table } from 'dexie'

export interface SettingRow {
  key: string
  value: unknown
}

/** One row per agent action — who asked, what ran, what decided it (spec §9d). */
export interface AuditRow {
  id?: number
  at: number
  goal: string
  tool: string
  args: Record<string, unknown>
  risk: string
  hardBlock: string | null
  decision: string
  ok: boolean | null
  detail: string
}

/** An encrypted profile: nothing about its contents is readable while locked. */
export interface VaultRow {
  id: string
  updatedAt: number
  cipher: string
  iv: string
}

/**
 * Local persistence. IndexedDB is available in both the service worker and
 * the side panel, so every context reads the same settings. Later batches
 * add tables for memory entries and recipes here.
 */
export class NavigatorDB extends Dexie {
  settings!: Table<SettingRow, string>
  audit!: Table<AuditRow, number>
  vault!: Table<VaultRow, string>

  constructor() {
    super('navigator')
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      settings: 'key',
      audit: '++id, at, tool',
    })
    this.version(3).stores({
      settings: 'key',
      audit: '++id, at, tool',
      vault: 'id, updatedAt',
    })
  }
}

export const db = new NavigatorDB()
