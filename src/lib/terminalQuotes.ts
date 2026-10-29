// Short quotes from Hackers (1995): https://www.imdb.com/title/tt0113243/quotes/
export const terminalQuotes = [
  'Hack the planet!',
  'Mess with the best, die like the rest.',
  "Spandex: it's a privilege, not a right.",
  'We are nameless!',
] as const

const storageKey = 'adb-vault-terminal-last-quote'
let lastQuote = -1

export function nextTerminalQuote() {
  try {
    const saved = localStorage.getItem(storageKey)
    const index = saved === null ? -1 : Number(saved)
    if (Number.isInteger(index) && index >= 0 && index < terminalQuotes.length) lastQuote = index
  } catch { /* Still rotate within this session when storage is unavailable. */ }
  lastQuote = lastQuote < 0
    ? Math.floor(Math.random() * terminalQuotes.length)
    : (lastQuote + 1 + Math.floor(Math.random() * (terminalQuotes.length - 1))) % terminalQuotes.length
  try { localStorage.setItem(storageKey, String(lastQuote)) } catch { /* Optional cosmetic preference. */ }
  return terminalQuotes[lastQuote]
}
