// One Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass filter whose cutoff rises with speed,
// so a still hand stops jittering while a fast movement is followed without lag.
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  /** Hz; lower = smoother when still */
  minCutoff: number
  /** how fast the cutoff rises with speed (per unit/s of the signal) */
  beta: number
  /** Hz; cutoff of the speed estimate */
  dCutoff: number

  constructor(minCutoff = 1.2, beta = 4, dCutoff = 1) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  reset() {
    this.x = null
    this.dx = 0
  }

  /** `tMs`: timestamp in milliseconds (monotonic). */
  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value
      this.dx = 0
      this.t = tMs
      return value
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000)
    this.t = tMs
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    this.dx += alpha(this.dCutoff) * ((value - this.x) / dt - this.dx)
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx)) * (value - this.x)
    return this.x
  }
}
