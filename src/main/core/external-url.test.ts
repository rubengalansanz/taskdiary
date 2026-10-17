import { describe, expect, it } from 'vitest'
import { isExternalUrlAllowed } from './external-url'

/**
 * Which URLs may reach the user's browser (Fase 6, S7).
 *
 * This predicate is the whole of the app's external-link security: `setWindowOpenHandler` denies
 * every window, and this is what decides whether the deny also happens *silently* or whether the
 * link is handed to the system browser. It lived as a private function inside `index.ts`, where
 * nothing could reach it — a security rule no test can call is a security rule nobody has checked.
 *
 * The dangerous cases are the ones that look like a URL but are not: `file:`, `javascript:` and
 * `data:` are the classic trio, and a naive check that only rejects `http:` on a malformed string
 * lets all of them through.
 */

describe('isExternalUrlAllowed', () => {
  it('opens an ordinary https link in the browser', () => {
    expect(isExternalUrlAllowed('https://example.com/docs')).toBe(true)
  })

  it('opens a mailto link in the mail client', () => {
    expect(isExternalUrlAllowed('mailto:someone@example.com')).toBe(true)
  })

  it('refuses plain http', () => {
    // Only `https:` was ever allowed. An http link is either obsolete or somebody's typo, and
    // opening it hands the URL to the browser over an unverified channel.
    expect(isExternalUrlAllowed('http://example.com')).toBe(false)
  })

  it('refuses a file url', () => {
    // The whole point of the packaged app is that its renderer has no filesystem reach. A
    // `file:` link would walk straight out of the sandbox this predicate exists to keep.
    expect(isExternalUrlAllowed('file:///C:/Windows/System32/cmd.exe')).toBe(false)
  })

  it('refuses a javascript url', () => {
    expect(isExternalUrlAllowed('javascript:alert(1)')).toBe(false)
  })

  it('refuses a data url', () => {
    expect(isExternalUrlAllowed('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('refuses a custom protocol', () => {
    // `something:` is how a registered handler gets invoked. Allowing it would let any page
    // the user clicks launch an arbitrary registered program.
    expect(isExternalUrlAllowed('steam://rungameid/440')).toBe(false)
  })

  it('refuses a relative path dressed up as a link', () => {
    expect(isExternalUrlAllowed('/settings')).toBe(false)
    expect(isExternalUrlAllowed('example.com')).toBe(false)
  })

  it('refuses anything it cannot parse rather than guessing', () => {
    // Failing closed is the whole point: an unparseable URL has an unknown protocol, and an
    // unknown protocol is not evidence of a safe one.
    expect(isExternalUrlAllowed('')).toBe(false)
    expect(isExternalUrlAllowed('   ')).toBe(false)
    expect(isExternalUrlAllowed('https://')).toBe(false)
  })

  it('does not care about the casing of the scheme', () => {
    // `URL` lowercases the scheme, so an uppercase `HTTPS:` is the same protocol and must get
    // the same answer — otherwise the check is bypassable by capitalisation.
    expect(isExternalUrlAllowed('HTTPS://example.com')).toBe(true)
  })

  it('is not fooled by a lookalike scheme', () => {
    // A prefix match would let `httpsx:` through. Parsing is what makes the protocol a protocol
    // instead of a string someone typed.
    expect(isExternalUrlAllowed('httpsx://example.com')).toBe(false)
    expect(isExternalUrlAllowed('mailtoevil://example.com')).toBe(false)
  })

  it('normalises an https scheme rather than trusting the text before it', () => {
    // `https:file:///etc/passwd` parses as `https://file///etc/passwd` — a genuine https URL
    // whose host happens to be `file`. Allowed is the right answer, and the reason is worth
    // pinning: the parser, not a substring check, is what decided. A substring check would have
    // seen `https:` and allowed `file:` too.
    expect(isExternalUrlAllowed('https:file:///etc/passwd')).toBe(true)
  })
})
