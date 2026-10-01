/**
 * Tiny deterministic PRNG (mulberry32) so the "synthetic" dataset is
 * reproducible across server restarts and test runs instead of generating
 * a different world every time. Not cryptographic, not meant to be.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.float() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("pick() called on an empty array");
    }
    return item;
  }

  chance(probability: number): boolean {
    return this.float() < probability;
  }

  gaussian(mean: number, stdDev: number): number {
    // Box-Muller transform.
    const u1 = Math.max(this.float(), Number.EPSILON);
    const u2 = this.float();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }
}
