import { WebSocket } from 'ws'

export class AudioPacedSender {
  private buffer: Uint8Array[] = [];
  private bufferedBytes = 0;
  private timer: any = null;
  private lastSendAt = 0;

  // --- Config ---
  constructor(
    private ws: WebSocket,
    private sampleRateHz = 8000,        // adjust to your stream
    private channels = 2,               // mono=1, stereo=2
    private bytesPerSample = 2,         // PCM 16-bit = 2
    private targetChunkDurationMs = 250,
    private MAXIMUM_BINARY_MESSAGE_SIZE = 64 * 1024 // safety limit
  ) {}

  /** Bytes that correspond to one pacing interval (e.g., 250 ms) */
  private get targetChunkBytes(): number {
    const bytesPerMs = (this.sampleRateHz * this.channels * this.bytesPerSample) / 1000;
    return Math.floor(bytesPerMs * this.targetChunkDurationMs); // e.g., 8000*1*2*0.25 = 4000 for 8kHz/16-bit/mono
  }

  /** Call this for every arriving audio frame */
  enqueue(chunk: Uint8Array) {
    if (!chunk || chunk.length === 0) return;
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.length;
    if (!this.timer) this.startPacer();
  }

  /** Begin the paced sending loop */
  private startPacer() {
    this.lastSendAt = performance.now();
    const tick = () => {
      if (this.ws.readyState !== 1) { // not OPEN
        this.stopPacer();
        return;
      }

      // If nothing buffered, pause the pacer until new data arrives
      if (this.bufferedBytes === 0) {
        this.stopPacer();
        return;
      }

      // Build up to targetChunkBytes (but never exceed MAX)
      const toSend = this.takeBytes(Math.min(this.targetChunkBytes, this.MAXIMUM_BINARY_MESSAGE_SIZE));

      try {
        this.ws.send(toSend, { binary: true });
      } catch (e) {
        // If send failed (closed, etc.), stop pacer to avoid a tight loop
        this.stopPacer();
        return;
      }

      // Drift-corrected scheduling to keep ≈250 ms cadence
      this.lastSendAt += this.targetChunkDurationMs;
      const now = performance.now();
      const delay = Math.max(0, this.lastSendAt - now);

      this.timer = setTimeout(tick, delay);
    };

    this.timer = setTimeout(tick, this.targetChunkDurationMs);
  }

  private stopPacer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Pull up to N bytes from the front of the buffer, concatenated */
  private takeBytes(n: number): Uint8Array {
    n = Math.min(n, this.bufferedBytes);
    if (n <= 0) return new Uint8Array(0);

    const out = new Uint8Array(n);
    let written = 0;

    while (written < n && this.buffer.length) {
      const head = this.buffer[0];
      const remaining = n - written;

      if (head.length <= remaining) {
        out.set(head, written);
        written += head.length;
        this.buffer.shift();
      } else {
        // split head
        out.set(head.subarray(0, remaining), written);
        this.buffer[0] = head.subarray(remaining);
        written += remaining;
      }
    }

    this.bufferedBytes -= n;
    return out;
  }

  /** In case to flush everything immediately (e.g:- on stop, barge in) */
  flushAll() {
    while (this.bufferedBytes > 0 && this.ws.readyState === 1) {
      const toSend = this.takeBytes(Math.min(this.targetChunkBytes, this.MAXIMUM_BINARY_MESSAGE_SIZE));
      this.ws.send(toSend, { binary: true });
    }
    this.stopPacer();
  }
}