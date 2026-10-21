import { recallMemories, saveMemory } from '@/memory/entries'

import type { MemoryAccess } from '@/tools/types'

/**
 * Long-term memory as the tool registry sees it (spec §4). The notes are plain
 * text in IndexedDB on this machine — the vault is where anything secret goes.
 */
export const memoryApi: MemoryAccess = {
  save: (input) => saveMemory(input),
  recall: (query, limit) => recallMemories(query, limit),
}
