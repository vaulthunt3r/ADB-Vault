import { XMLParser, XMLValidator } from 'fast-xml-parser'
export const databaseFiles = {
  'trackers.xml': 'app/src/main/res/values/trackers.xml',
  'libs.xml': 'app/src/main/res/values/libs.xml',
  'native_libs.xml': 'app/src/main/res/values/native_libs.xml',
  'debloat.json': 'app/src/main/assets/debloat.json',
  'suggestions.json': 'app/src/main/assets/suggestions.json',
} as const
export type DatabaseFile = keyof typeof databaseFiles
export interface Signature { name: string; signature: string; kind?: string; website?: string; tracker?: boolean }
export interface Bloatware { id: string; label?: string; description?: string; removal?: string; type?: string; warning?: string; dependencies?: string[]; required_by?: string[]; suggestions?: string }
export interface Suggestion { id: string; _id: string; label?: string; reason?: string; repo?: string }
export interface SignatureDatabase { revision: string; sizes: Record<DatabaseFile, number>; trackers: Signature[]; libraries: Signature[]; native: Signature[]; bloatware: Bloatware[]; suggestions: Suggestion[] }
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value]
// Android resource escaping is distinct from XML entity escaping.
function androidString(value: string) { return value.replace(/\\(\\|'|"|\?|@)/g, '$1') }
function xmlArrays(xml: string) {
  if (xml.length > 8_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid signature XML.')
  const doc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(xml)
  const result: Record<string, string[]> = {}
  for (const tag of ['array', 'string-array', 'integer-array']) for (const entry of array(doc.resources?.[tag]) as { '@_name': string; item: unknown }[]) {
    const values = array(entry.item)
    if (values.length > 30000 || values.some(v => typeof v !== 'string' || v.length > 8192)) throw new Error('Invalid signature array.')
    result[entry['@_name']] = (values as string[]).map(androidString)
  }
  return result
}
function signatures(xml: string, prefix: string, native = false): Signature[] {
  const data = xmlArrays(xml), sigs = data[`${prefix}_signatures`], names = data[`${prefix}_names`]
  if (!sigs?.length || names?.length !== sigs.length || data[`${prefix}_types`] && data[`${prefix}_types`].length !== sigs.length || native && (data.lib_native_is_tracker?.length !== sigs.length || data.lib_native_website?.length !== sigs.length)) throw new Error('Signature arrays do not align.')
  return sigs.map((signature, i) => {
    if (!signature || !names[i] || /[\x00-\x1f]/.test(signature)) throw new Error('Invalid code signature.')
    if (native) new RegExp(signature) // Executed only inside the bounded scanner worker.
    return { signature, name: names[i], kind: data[`${prefix}_types`]?.[i], website: data[`${prefix}_website`]?.[i], ...(native ? { tracker: data.lib_native_is_tracker[i] === '1' } : {}) }
  })
}
export function parseDatabase(files: Record<DatabaseFile, string>, revision: string): SignatureDatabase {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid database revision.')
  if (Object.values(files).some(f => f.length > 8_000_000)) throw new Error('Database exceeds size limit.')
  const bloatware = JSON.parse(files['debloat.json']), suggestions = JSON.parse(files['suggestions.json'])
  for (const list of [bloatware, suggestions]) if (!Array.isArray(list) || !list.length || list.length > 50000 || list.some(e => !e || typeof e.id !== 'string' || !/^[\w.]+$/.test(e.id) || Object.values(e).some(v => typeof v === 'string' && v.length > 50000))) throw new Error('Invalid package database.')
  const sizes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, Buffer.byteLength(content)])) as Record<DatabaseFile, number>
  return { revision, sizes, trackers: signatures(files['trackers.xml'], 'tracker'), libraries: signatures(files['libs.xml'], 'lib'), native: signatures(files['native_libs.xml'], 'lib_native', true), bloatware, suggestions }
}

// Literal multi-pattern substring matching, including overlapping signatures.
export class SignatureMatcher {
  private nodes: { next: Map<string, number>; fail: number; out: number[] }[] = [{ next: new Map(), fail: 0, out: [] }]
  constructor(signatures: Signature[]) {
    signatures.forEach((s, index) => {
      let node = 0
      for (const ch of s.signature) {
        let next = this.nodes[node].next.get(ch)
        if (next === undefined) { next = this.nodes.length; this.nodes[node].next.set(ch, next); this.nodes.push({ next: new Map(), fail: 0, out: [] }) }
        node = next
      }
      this.nodes[node].out.push(index)
    })
    const queue = [...this.nodes[0].next.values()]
    for (let i = 0; i < queue.length; i++) {
      const parent = queue[i]
      for (const [ch, child] of this.nodes[parent].next) {
        queue.push(child)
        let fail = this.nodes[parent].fail
        while (fail && !this.nodes[fail].next.has(ch)) fail = this.nodes[fail].fail
        this.nodes[child].fail = this.nodes[fail].next.get(ch) ?? 0
        this.nodes[child].out.push(...this.nodes[this.nodes[child].fail].out)
      }
    }
  }
  search(text: string) {
    const found = new Set<number>(); let node = 0
    for (const ch of text) {
      while (node && !this.nodes[node].next.has(ch)) node = this.nodes[node].fail
      node = this.nodes[node].next.get(ch) ?? 0
      for (const index of this.nodes[node].out) found.add(index)
    }
    return [...found]
  }
}
