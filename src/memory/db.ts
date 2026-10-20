import Dexie, { type Table } from 'dexie'

export interface SettingRow {
  key: string
  value: unknown
}

/**
 * Local persistence. IndexedDB is available in both the service worker and
 * the side panel, so every context reads the same settings. Later batches
 * add tables for memory entries, audit log and recipes here.
 */
export class NavigatorDB extends Dexie {
  settings!: Table<SettingRow, string>

  constructor() {
    super('navigator')
    this.version(1).stores({
      settings: 'key',
    })
  }
}

export const db = new NavigatorDB()
