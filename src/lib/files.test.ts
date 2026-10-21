import { describe, expect, it } from 'vitest'

import { DOWNLOAD_EXTENSIONS, TEXT_EXTENSIONS, extensionOf, guardFile, guardRemoteUrl, mimeFor, safeFileName } from './files'

describe('safeFileName', () => {
  it('keeps only the last path segment', () => {
    expect(safeFileName('reports/2026/invoice.pdf')).toBe('invoice.pdf')
    expect(safeFileName('C:\\Users\\manav\\Downloads\\resume.docx')).toBe('resume.docx')
  })

  it('strips what a filesystem would refuse or hide', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('.hidden')).toBe('hidden')
    expect(safeFileName('a<b>c:d"e|f?g*h')).toBe('abcdefgh')
    expect(safeFileName('   ')).toBe('untitled')
    expect(safeFileName('note...')).toBe('note')
  })

  it('caps the length', () => {
    expect(safeFileName(`${'x'.repeat(200)}.md`)).toHaveLength(80)
  })
})

describe('guardFile', () => {
  it('puts the file in the Navigator folder when the extension is allowed', () => {
    expect(guardFile('summary.md', TEXT_EXTENSIONS, 'text file')).toEqual({
      ok: true,
      path: 'Navigator/summary.md',
      name: 'summary.md',
    })
  })

  it('refuses an extension that is not on the list', () => {
    const blocked = guardFile('payload.exe', DOWNLOAD_EXTENSIONS, 'download')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('.exe')
  })

  it('refuses a name with no extension at all', () => {
    const noExt = guardFile('README', TEXT_EXTENSIONS, 'text file')
    expect(noExt.ok).toBe(false)
    if (!noExt.ok) expect(noExt.error).toContain('no file extension')
  })

  it('will not download a script or an SVG', () => {
    expect(guardFile('widget.js', DOWNLOAD_EXTENSIONS, 'download').ok).toBe(false)
    expect(guardFile('logo.svg', DOWNLOAD_EXTENSIONS, 'download').ok).toBe(false)
  })
})

describe('guardRemoteUrl', () => {
  it('accepts http and https only', () => {
    expect(guardRemoteUrl('https://example.com/a.pdf')).toEqual({ ok: true, url: 'https://example.com/a.pdf' })
    expect(guardRemoteUrl('javascript:alert(1)').ok).toBe(false)
    expect(guardRemoteUrl('file:///C:/Windows/win.ini').ok).toBe(false)
    expect(guardRemoteUrl('chrome://settings').ok).toBe(false)
  })

  it('rejects something that is not a URL', () => {
    const bad = guardRemoteUrl('not a url')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('not a full URL')
  })
})

describe('extensionOf and mimeFor', () => {
  it('reads the extension from the file name, not the path', () => {
    expect(extensionOf('Navigator/v1.2/report.CSV')).toBe('csv')
    expect(extensionOf('archive')).toBe('')
    expect(mimeFor('notes.md')).toBe('text/markdown')
    expect(mimeFor('notes.txt')).toBe('text/plain')
    expect(mimeFor('thing.bin')).toBe('application/octet-stream')
  })
})
