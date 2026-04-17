/**
 * Returns true only for http(s) URLs. Blocks javascript:, data:, vbscript:, etc.
 * which could otherwise fire a prompt-injected payload when a user clicks an
 * AI-produced research-source link.
 */
export function isSafeHttpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}
