import { describe, expect, it } from 'vitest'

import { cosine, clusterTabs, deterministicName, describeCluster, MIN_SIMILARITY, tabVector } from './cluster'
import { tab } from './testUtils'

const YOU_TUBE = [
  tab(1, { index: 0, url: 'https://www.youtube.com/watch?v=abc', title: 'Heat pumps explained' }),
  tab(2, { index: 1, url: 'https://youtube.com/watch?v=def', title: 'Underfloor heating tour' }),
  tab(3, { index: 2, url: 'https://music.youtube.com/listen', title: 'Lo-fi study mix' }),
]

describe('tabVector / cosine', () => {
  it('gives a tab a unit-length vector', () => {
    const vector = tabVector(YOU_TUBE[0]!)
    expect(cosine(vector, vector)).toBeCloseTo(1)
  })

  it('scores two unrelated tabs at zero', () => {
    const a = tabVector(tab(1, { url: 'https://bluewhale.shop/one', title: 'Cobalt' }))
    const b = tabVector(tab(2, { url: 'https://greenfern.bar/two', title: 'Verdant' }))
    expect(cosine(a, b)).toBe(0)
  })

  it('scores the same host above the join threshold', () => {
    const a = tabVector(YOU_TUBE[0]!)
    const b = tabVector(YOU_TUBE[1]!)
    expect(cosine(a, b)).toBeGreaterThan(MIN_SIMILARITY)
  })
})

describe('clusterTabs', () => {
  it('puts tabs of one site into one cluster', () => {
    const clusters = clusterTabs(YOU_TUBE)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.tabs.map((entry) => entry.id)).toEqual([1, 2, 3])
    expect(clusters[0]!.host).toBe('youtube.com')
  })

  it('leaves a lone dissimilar tab ungrouped', () => {
    const clusters = clusterTabs([
      ...YOU_TUBE,
      tab(9, { index: 9, url: 'https://arxiv.org/abs/1706.03762', title: 'Attention is all you need' }),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.tabs.some((entry) => entry.id === 9)).toBe(false)
  })

  it('never clusters across windows: Chrome groups live inside one window', () => {
    const reddit = (id: number, windowId: number): typeof YOU_TUBE[number] =>
      tab(id, { windowId, index: 0, url: `https://reddit.com/r/heatpump/${id}`, title: 'Heat pump thread' })
    const clusters = clusterTabs([reddit(1, 1), reddit(2, 1), reddit(3, 2), reddit(4, 2)])
    expect(clusters.map((cluster) => cluster.windowId).sort()).toEqual([1, 2])
    for (const cluster of clusters) expect(cluster.tabs).toHaveLength(2)
  })

  it('does not join unrelated sites because both hosts end in .com', () => {
    const clusters = clusterTabs([
      tab(1, { index: 0, url: 'https://youtube.com/watch', title: 'Lo-fi study mix' }),
      tab(2, { index: 1, url: 'https://netflix.com/browse', title: 'Grid connection documentary' }),
    ])
    expect(clusters).toHaveLength(0)
  })

  it('respects a stricter threshold', () => {
    expect(clusterTabs(YOU_TUBE, { minSimilarity: 0.99 })).toHaveLength(0)
  })

  it('drops clusters smaller than the minimum size', () => {
    expect(clusterTabs(YOU_TUBE, { minSize: 4 })).toHaveLength(0)
  })
})

describe('names', () => {
  it('uses the brand when one host owns the cluster', () => {
    expect(deterministicName(clusterTabs(YOU_TUBE)[0]!)).toBe('YouTube')
  })

  it('uses shared terms when the cluster spans hosts, ignoring registry suffixes', () => {
    const cluster = clusterTabs([
      tab(1, { index: 0, url: 'https://acme.example/invoices', title: 'Q3 invoices' }),
      tab(2, { index: 1, url: 'https://beta.example/invoices', title: 'Q3 invoices due' }),
    ])[0]
    expect(cluster).toBeDefined()
    expect(cluster!.terms).not.toContain('com')
    expect(deterministicName(cluster!)).toBe('Invoice')
  })

  it('describes the members for the model prompt', () => {
    const text = describeCluster(clusterTabs(YOU_TUBE)[0]!)
    expect(text).toContain('"Heat pumps explained" (youtube.com)')
    expect(text.split(',')).toHaveLength(3)
  })
})
