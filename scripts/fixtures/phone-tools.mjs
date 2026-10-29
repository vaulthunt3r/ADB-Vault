export const target = { id: 'phone', serial: 'TEST', transportId: '7' }
export const contacts = [
  { kind: 'contacts', id: '1', name: 'Ирина, "Work"', phones: ['+79001234567', '+79007654321'], emails: ['irina@example.test'], organizations: ['Team'], vcard: 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ирина\\, Work\r\nTEL:+79001234567\r\nTEL:+79007654321\r\nNOTE:First\\nSecond\r\nBDAY:1990-01-02\r\nEND:VCARD\r\n' },
  { kind: 'contacts', id: '2', name: '=SUM(1,2)', phones: ['+123'], emails: [], organizations: [], vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:=SUM(1\\,2)\nTEL:+123\nEND:VCARD\n' },
]
export const calls = [{ kind: 'calls', id: '11', number: '+79001234567', name: 'Ирина', date: 1792454400000, duration: 42, type: 1, account: 'SIM 1' }]
export const sms = [{ kind: 'sms', id: '21', address: '+79001234567', date: 1792454400000, dateSent: 1792454399000, type: 1, body: 'Привет 👋\n<script>alert("test")</script>&\nSecond line', read: false, subscription: '1', threadId: '8' }]
export const sampleText = 'Привет 👋\n"quotes" & $HOME; $(whoami) | <tag>'
export const samples = { contacts, calls, sms }
export function response(operation, options = {}) {
  const rows = options.rows ?? samples[operation] ?? []
  return [
    { type: 'hello', protocol: 1, operation, userId: options.userId ?? 0 },
    ...(operation === 'clipboard-read' ? [{ type: 'clipboard', text: options.text ?? sampleText }]
      : operation === 'clipboard-write' ? [{ type: 'written', verified: true }]
      : [{ type: 'progress', completed: 0, total: rows.length }, ...rows.map(record => ({ type: 'record', record })), { type: 'progress', completed: rows.length, total: rows.length }]),
    { type: 'done', count: rows.length },
  ].map(item => JSON.stringify(item)).join('\n') + '\n'
}
