// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { collectLinks, normalizeDate, readArticle, readAuthor, readPublishDate } from './article'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

function load(head: string, body: string): void {
  document.head.innerHTML = head
  document.body.innerHTML = body
}

const HEAD = `
  <meta name="author" content="Nina Okoye">
  <meta property="article:published_time" content="2026-02-11T09:00:00Z">
`

const BODY = `
  <nav>Site menu, subscribe, sign in</nav>
  <article>
    <h1>Heat pumps, metered for two years</h1>
    <p>Heat pumps cut heating bills by 40 percent in the 30 homes we metered through two winters of use.</p>
    <p>The payback period was seven years, and homes with old radiators saved considerably less than new builds did.</p>
  </article>
  <footer>Copyright notice</footer>
`

describe('readArticle', () => {
  it('returns main content without the site chrome', () => {
    load(HEAD, BODY)
    const article = readArticle(document)
    expect(article.title).toBe('Heat pumps, metered for two years')
    expect(article.text).toContain('cut heating bills by 40 percent')
    expect(article.text).not.toContain('Site menu')
    expect(article.text).not.toContain('Copyright')
    expect(article.url).toBe(document.baseURI)
  })

  it('keeps the byline and normalises the publish date', () => {
    load(HEAD, BODY)
    const article = readArticle(document)
    expect(article.author).toBe('Nina Okoye')
    expect(article.publishDate).toBe('2026-02-11')
  })

  it('reads author and date out of JSON-LD when no meta tag exists', () => {
    load(
      '<script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"J. Rivera"},"datePublished":"2026-05-01T12:00:00+08:00"}</script>',
      '<p>Some body copy long enough to be picked as the main container of this page, repeated until the scorer is happy with the size.</p>',
    )
    expect(readAuthor(document)).toBe('J. Rivera')
    expect(normalizeDate(readPublishDate(document))).toBe('2026-05-01')
  })

  it('tolerates a broken JSON-LD block', () => {
    load('<script type="application/ld+json">{not json</script>', BODY)
    expect(readAuthor(document)).toBeNull()
  })
})

describe('normalizeDate', () => {
  it('keeps an unparsable string instead of inventing a date', () => {
    expect(normalizeDate('last Tuesday')).toBe('last Tuesday')
    expect(normalizeDate(null)).toBeNull()
  })
})

describe('collectLinks', () => {
  it('resolves relative hrefs and pairs each anchor with its snippet', () => {
    load(
      '',
      `<div class="result"><a href="/one">First result</a><p class="result__snippet">Heat pump savings.</p></div>
       <div class="result"><a href="https://other.example/two">Second result</a></div>
       <div><a href="#top">   </a></div>`,
    )
    const links = collectLinks(document)
    expect(links.map((link) => link.title)).toEqual(['First result', 'Second result'])
    expect(links[0]?.url).toBe(`${document.baseURI}one`)
    expect(links[0]?.snippet).toContain('Heat pump savings')
    expect(links[1]?.snippet).toBe('')
  })
})
