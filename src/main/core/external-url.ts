/**
 * Which URLs may reach the user's browser (Fase 6, S7).
 *
 * This is the whole of the app's external-link security. `setWindowOpenHandler` denies every
 * window, and this predicate decides whether the deny also happens *silently* or whether the link
 * is handed to the system browser and mail client instead.
 *
 * It used to be a private function inside `main/index.ts`, where nothing could reach it. A
 * security rule that no test can call is a security rule nobody has checked, and S7 is exactly
 * the acceptance criterion that says the external-link behaviour is a promise to the user rather
 * than an implementation detail.
 *
 * Fails closed throughout: an unparseable URL has an unknown protocol, and an unknown protocol is
 * not evidence of a safe one.
 */

/**
 * Reports whether a URL may be opened outside the app.
 *
 * Only `https:` and `mailto:` qualify. Everything else — `http:`, `file:`, `javascript:`,
 * `data:`, any registered custom protocol, any relative path, anything unparseable — is refused.
 *
 * @param url The URL a window-open request carried.
 * @returns True when the URL may be handed to the operating system.
 */
export function isExternalUrlAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url)

    return protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}
