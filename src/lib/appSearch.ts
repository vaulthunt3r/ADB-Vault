export interface AppSearch {
  text: string
  packages: ReadonlySet<string> | null
}

/** A single phrase keeps substring search; package lists use exact OR matching. */
export function parseAppSearch(source: string): AppSearch {
  const text = source.trim().toLowerCase()
  // Ignore reference URLs in copied lists. Markdown, bullets and explanations may surround IDs.
  const withoutLinks = source.replace(/(?:https?:\/\/|www\.)\S+/gi, '')
  const plainList = withoutLinks.trim().split(/[\s,;]+/).every(token => /^(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+|android)$/.test(token))
  const tokens = [...withoutLinks.matchAll(/(?<![A-Za-z0-9_./:@\\-])(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+|android)(?![A-Za-z0-9_./:@\\-])/g)].filter(match => {
    if (match[0] !== 'android' || plainList) return true
    // The framework ID is also an ordinary word. Accept it only as an explicit list item.
    const index = match.index
    const quote = withoutLinks[index - 1]
    if (quote && /[`"']/.test(quote) && withoutLinks[index + match[0].length] === quote) return true
    const before = withoutLinks.slice(0, index).split(/[,;\r\n]/).at(-1) || ''
    const after = withoutLinks.slice(index + match[0].length).split(/[,;\r\n]/)[0]
    return /^\s*(?:(?:[-*•]|\d+[.)])\s+)?$/.test(before) && /^\s*$/.test(after)
  }).map(match => match[0].toLowerCase())
  const list = tokens.length > 1 || tokens.length === 1 && /[,;\r\n`]|^\s*[-*•]\s/.test(source)
  return { text, packages: list ? new Set(tokens) : null }
}

export function matchesAppSearch(app: { label: string; packageName: string }, search: AppSearch): boolean {
  return search.packages
    ? search.packages.has(app.packageName.toLowerCase())
    : `${app.label} ${app.packageName}`.toLowerCase().includes(search.text)
}

/** Handle paste before a single-line input removes line breaks and joins adjacent IDs. */
export function pastedAppSearch(source: string): string | null {
  const packages = parseAppSearch(source).packages
  if (!packages) return null
  const names = [...packages]
  return names.length === 1 ? '`' + names[0] + '`' : names.join(', ')
}
