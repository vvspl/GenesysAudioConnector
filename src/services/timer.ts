// src/Timer.ts

export class Timer<R = any> {
  private callback: () => R | Promise<R>;
  private delay: number;
  private timerHalted : boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param callback A function (sync or async) to invoke after the timeout.
   * @param delay    Timeout in milliseconds.
   */
  constructor(callback: () => R | Promise<R>, delay: number) {
    this.callback = callback;
    this.delay = delay;
  }

  /**
   * Starts the timer. If one was already running, it will be cleared first.
   */
  startTimer(): void {
    if (this.timerHalted) {
      // if the timer is halted, do not start it again
      console.log(`[NoInputTimer]StartTimer Triggerred| Timer is halted, not starting again.`);
      return;
    }
    console.log(`[NoInputTimer]StartTimer Triggerred| current Timer ID:${this.timerId}| Which will be cleared now.`);
    this.stopTimer();
    this.timerId = setTimeout(() => {
      // Always wrap in Promise.resolve to handle both sync & async callbacks
      Promise.resolve(this.callback());
    }, this.delay);

  }

  /**
   * Stops any pending timer so the callback will not be invoked.
   */
  stopTimer(): void {
    if (this.timerId !== null) {
      console.log(`[NoInputTimer]StopTimer Triggerred|current Timer ID:${this.timerId}| Which will be cleared now.`);
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
  /**
   * Halts the timer, preventing it from starting again.
   */
  haltTimer(): void {
    console.log(`[NoInputTimer]HaltTimer Triggerred| Current Timer Halt State:${this.timerHalted}|current Timer ID:${this.timerId}| Which will be cleared now.`);
    this.timerHalted = true;
    this.stopTimer();
  }
  resumeTimer(): void {
    console.log(`[NoInputTimer]ResumeTimer Triggerred| Current Timer Halt State:${this.timerHalted}|current Timer ID:${this.timerId}| Which will be cleared now.`);
    this.timerHalted = false;
    this.stopTimer();
  }
}
