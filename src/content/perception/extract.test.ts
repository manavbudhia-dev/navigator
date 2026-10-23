// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { extractMarkdown, pickMainContainer } from './extract'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('extractMarkdown', () => {
  it('converts headings, links, lists and tables from the main container', () => {
    document.body.innerHTML = `
      <nav><a href="/menu">Menu noise</a></nav>
      <main>
        <article>
          <h1>Q3 Report</h1>
          <p>Revenue grew, see <a href="https://example.com/sec">the filing</a> for details.</p>
          <ul><li>First point</li><li>Second point</li></ul>
          <table><tr><th>Metric</th><th>Value</th></tr><tr><td>Revenue</td><td>10</td></tr></table>
        </article>
      </main>
      <footer><p>Copyright</p></footer>
    `
    const markdown = extractMarkdown(document)

    expect(markdown).toContain('# Q3 Report')
    expect(markdown).toContain('[the filing](https://example.com/sec)')
    expect(markdown).toContain('- First point')
    expect(markdown).not.toContain('1. First point')
    expect(markdown).toContain('| Metric | Value |')
    expect(markdown).not.toContain('Menu noise')
    expect(markdown).not.toContain('Copyright')
  })

  it('prefers the text-heavy container when no semantic main exists', () => {
    document.body.innerHTML = `
      <div id="links">${Array.from({ length: 20 }, (_, i) => `<p><a href="/l${i}">link ${i}</a></p>`).join('')}</div>
      <div id="prose">${Array.from({ length: 8 }, (_, i) => `<p>This is paragraph number ${i} with a reasonable amount of real prose content inside it.</p>`).join('')}</div>
    `
    const container = pickMainContainer(document)
    expect(container.id).toBe('prose')

    const markdown = extractMarkdown(document)
    expect(markdown).toContain('paragraph number 3')
    expect(markdown).not.toContain('link 5')
  })

  it('collapses whitespace and deduplicates repeated blocks', () => {
    document.body.innerHTML = `
      <main>
        <p>Same   line</p>
        <p>Same line</p>
      </main>
    `
    const markdown = extractMarkdown(document)
    expect(markdown).toBe('Same line')
  })

  it('keeps the words of a link whose target would run code', () => {
    document.body.innerHTML = `
      <main>
        <p>Read the <a href="javascript:alert(1)">terms</a> or the
        <a href="data:text/html,payload">summary</a> or the
        <a href="/pricing">pricing</a>.</p>
      </main>
    `
    const markdown = extractMarkdown(document)

    // The link text is content; the target is an instruction to the reader.
    expect(markdown).toContain('terms')
    expect(markdown).toContain('summary')
    expect(markdown).not.toContain('javascript:')
    expect(markdown).not.toContain('data:text/html')
    expect(markdown).not.toContain('[terms]')
    // A relative link is still a link the page really points at.
    expect(markdown).toContain('[pricing](/pricing)')
  })
})
