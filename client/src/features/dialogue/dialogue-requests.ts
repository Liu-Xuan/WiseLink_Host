/** Foreground actions supersede background reads; an old completion never owns new state. */
export class DialogueRequests {
  private active: AbortController | null = null;
  private background = false;
  start(background: boolean): AbortController | null {
    if (this.active && (!this.background || background)) return null;
    this.active?.abort();
    this.active = new AbortController();
    this.background = background;
    return this.active;
  }
  finish(controller: AbortController): boolean {
    if (this.active !== controller) return false;
    this.active = null;
    return true;
  }
  stop(): void {
    this.active?.abort();
    this.active = null;
  }
}
