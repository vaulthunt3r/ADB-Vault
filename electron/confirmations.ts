import { randomUUID } from 'node:crypto'
import type { ConfirmationContent, ConfirmationState } from './confirmation-protocol.js'

// Only the main process creates the plan; the renderer can answer its one-use ID.
export class Confirmations {
  state: ConfirmationState = { revision: 0, prompt: null }
  private resolve?: (accepted: boolean) => void
  constructor(private publish: (state: ConfirmationState) => void) {}
  ask(content: ConfirmationContent): Promise<boolean> {
    if (this.resolve) throw new Error('Finish the open confirmation first.')
    return new Promise(resolve => {
      this.resolve = resolve
      this.state = { revision: this.state.revision + 1, prompt: { ...content, id: randomUUID() } }
      this.publish(this.state)
    })
  }
  answer(id: string, accepted: boolean) {
    if (!this.resolve || id !== this.state.prompt?.id) throw new Error('This confirmation is no longer active.')
    const resolve = this.resolve
    this.resolve = undefined
    this.state = { revision: this.state.revision + 1, prompt: null }
    this.publish(this.state)
    resolve(accepted)
  }
  cancel() { if (this.state.prompt) this.answer(this.state.prompt.id, false) }
}
