import { describe, expect, it } from 'vitest'

import { ActionQueue } from './queue'

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('ActionQueue', () => {
  it('runs tasks strictly one at a time, in order', async () => {
    const queue = new ActionQueue()
    const order: number[] = []
    const gates = [deferred(), deferred()]

    const first = queue.enqueue(async () => {
      order.push(1)
      await gates[0]!.promise
      order.push(11)
      return 'a'
    })
    const second = queue.enqueue(async () => {
      order.push(2)
      gates[1]!.release()
      order.push(22)
      return 'b'
    })

    await Promise.resolve()
    expect(order).toEqual([1])
    expect(queue.busy).toBe(true)

    gates[0]!.release()
    await first

    expect(await second).toBe('b')
    expect(order).toEqual([1, 11, 2, 22])
    expect(queue.busy).toBe(false)
  })

  it('propagates a task error without wedging the queue', async () => {
    const queue = new ActionQueue()
    const boom = queue.enqueue(async () => {
      throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')

    const fine = queue.enqueue(async () => 'ok')
    await expect(fine).resolves.toBe('ok')
  })

  it('cancelPending rejects everything not yet started', async () => {
    const queue = new ActionQueue()
    const gate = deferred()

    const running = queue.enqueue(async () => {
      await gate.promise
      return 'running'
    })
    const neverRuns = queue.enqueue(async () => 'never')
    const neverEither = queue.enqueue(async () => 'never')

    await Promise.resolve()
    expect(queue.size).toBe(2)

    expect(queue.cancelPending()).toBe(2)
    await expect(neverRuns).rejects.toThrow('Cancelled before execution.')
    await expect(neverEither).rejects.toThrow('Cancelled before execution.')

    gate.release()
    await expect(running).resolves.toBe('running')
    expect(queue.size).toBe(0)
  })
})
