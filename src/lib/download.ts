/** Save through Chrome's download UI when it exists, otherwise click a blob link. */
export async function saveTextFile(name: string, mime: string, text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  try {
    if (typeof chrome !== 'undefined' && chrome.downloads !== undefined) {
      await chrome.downloads.download({ url, filename: name, saveAs: true })
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  } finally {
    // Revoking too early cancels the download; the link needs the blob alive.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

export function stampedFilename(prefix: string, extension: string, at = Date.now()): string {
  const stamp = new Date(at).toISOString().slice(0, 10)
  return `${prefix}-${stamp}.${extension}`
}
