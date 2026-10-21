/**
 * Bounded worker pool (spec §7: "queue-based worker pool so we never spawn
 * 30 tabs"). Results keep input order; the first failure wins and stops the
 * remaining workers from picking up new items.
 */

export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R | undefined>(items.length).fill(undefined)
  const size = Math.min(Math.max(1, concurrency), items.length)
  let cursor = 0
  let failure: unknown = null

  const runners: Promise<void>[] = []
  for (let slot = 0; slot < size; slot += 1) {
    runners.push(
      (async (): Promise<void> => {
        for (;;) {
          if (failure !== null) return
          if (signal?.aborted === true) {
            failure ??= abortError()
            return
          }
          const index = cursor
          cursor += 1
          if (index >= items.length) return
          try {
            results[index] = await worker(items[index] as T, index)
          } catch (error) {
            failure ??= error
            return
          }
        }
      })(),
    )
  }

  await Promise.all(runners)
  if (failure !== null) throw failure
  return results as R[]
}

function abortError(): Error {
  const error = new Error('Research was stopped.')
  error.name = 'AbortError'
  return error
}

/** A promise that rejects when the signal fires; used by the gather loop. */
export function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error('Research was stopped.'))
    signal.addEventListener('abort', () => reject(new Error('Research was stopped.')), { once: true })
  })
}

/**
 * Run one async task with a timeout. Tab loads can hang forever on a hostile
 * page, and a hanging page must not hang the whole research run.
 */
export async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms.`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
