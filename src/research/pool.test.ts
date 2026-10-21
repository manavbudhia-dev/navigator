import { describe, expect, it } from 'vitest'

import { runPool, withTimeout } from './pool'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('runPool', () => {
  it('keeps input order regardless of completion order', async () => {
    const durations = [40, 0, 20, 10]
    const out = await runPool(durations, 4, async (ms, index) => {
      await wait(ms)
      return index
    })
    expect(out).toEqual([0, 1, 2, 3])
  })

  it('never runs more tasks than the concurrency limit', async () => {
    let live = 0
    let peak = 0
    await runPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      live += 1
      peak = Math.max(peak, live)
      await wait(5)
      live -= 1
    })
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('returns an empty list without touching the worker', async () => {
    let calls = 0
    await expect(runPool([], 4, async () => {
      calls += 1
      return 1
    })).resolves.toEqual([])
    expect(calls).toBe(0)
  })

  it('rejects with the first failure and stops picking up new items', async () => {
    let started = 0
    const promise = runPool([1, 2, 3, 4, 5, 6], 2, async (item) => {
      started += 1
      await wait(item === 1 ? 5 : 30)
      if (item === 1) throw new Error('boom')
      return item
    })
    await expect(promise).rejects.toThrow('boom')
    expect(started).toBeLessThanOrEqual(2)
  })

  it('stops on an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    await expect(runPool([1, 2], 2, async () => {
      calls += 1
      return 1
    }, controller.signal)).rejects.toThrow('stopped')
    expect(calls).toBe(0)
  })
})

describe('withTimeout', () => {
  it('passes a fast promise through', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects a hanging promise', async () => {
    await expect(withTimeout(new Promise<string>(() => undefined), 5)).rejects.toThrow('Timed out after 5 ms')
  })
})
