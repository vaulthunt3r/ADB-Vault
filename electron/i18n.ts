// ADB Vault has an English-only interface. Keep these shared formatting helpers
// so authored messages retain their placeholders and user-provided values.
export const locale = () => 'en-US'

export function t(source: string, values: readonly unknown[] = []): string {
  return values.length ? source.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match) : source
}

export function message(source: string | null | undefined): string { return source || '' }
