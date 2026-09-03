/**
 * Hand a generated file to the user, from a browser.
 *
 * This is the ordinary web way of doing it: build a blob, click a link at it, let the
 * browser put it wherever downloads go. It is only correct in a browser. The desktop app
 * uses a save dialog instead, because a webview either swallows this silently or shows its
 * own download strip and drops the file somewhere the user did not choose, and neither is
 * what an installed application should do.
 */
export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
  return name
}
