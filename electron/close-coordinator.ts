/** One confirmation and shutdown path for the title-bar close, Alt+F4 and app.quit(). */
export class CloseCoordinator {
  ready = false
  private pending?: Promise<void>
  constructor(private operations: () => string[], private confirm: (operations: string[]) => Promise<boolean>,
    private shutdown: () => Promise<void>, private finish: () => void, private reportError: (error: unknown) => Promise<void>) {}

  request() {
    if (this.ready) return Promise.resolve()
    if (this.pending) return this.pending
    const task = this.close()
    this.pending = task
    void task.finally(() => { if (this.pending === task) this.pending = undefined }).catch(() => {})
    return task
  }
  private async close() {
    try {
      let active = this.operations()
      while (active.length) {
        if (!await this.confirm(active)) return
        const covered = new Set(active)
        const current = this.operations()
        if (!current.some(item => !covered.has(item))) break
        active = current // Work started while the prompt was open needs its own consent.
      }
    } catch (error) { await this.reportError(error).catch(() => {}); return } // A failed prompt never grants consent.
    try { await this.shutdown() }
    catch (error) { await this.reportError(error).catch(() => {}) }
    this.ready = true
    this.finish()
  }
}
