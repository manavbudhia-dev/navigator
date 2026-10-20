import { vi } from 'vitest'

export interface FakeRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * jsdom has no layout engine, so every getBoundingClientRect returns zeros
 * (which our visibility check reads as "hidden"). Tests register the rects
 * they care about; anything unregistered stays invisible.
 *
 * Each window owns its own HTMLElement prototype, so documents inside iframes
 * need their window passed in explicitly.
 */
export function mockRects(
  rects: Map<Element, FakeRect>,
  windows: Array<Window & typeof globalThis> = [window],
): void {
  for (const win of windows) {
    vi.spyOn(win.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ): DOMRect {
      const rect = rects.get(this) ?? { x: 0, y: 0, width: 0, height: 0 }
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON: () => rect,
      } as DOMRect
    })
  }
}

export function rect(x: number, y: number, width = 100, height = 30): FakeRect {
  return { x, y, width, height }
}
