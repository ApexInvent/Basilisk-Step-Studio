/**
 * Open a link outside the app.
 *
 * A plain anchor is wrong in the desktop build. There is one webview and it is the entire
 * application, so following a link in it navigates away from the app with no way back. The
 * shell hands the URL to the system browser instead.
 */
import { isDesktop } from '@/engine'

export async function openExternal(url) {
  if (!isDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}
