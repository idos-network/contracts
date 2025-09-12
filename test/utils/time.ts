export class Duration {
  static {
    this.minutes = (n: int): int => 60 * n;
    this.hours   = (n: int): int => 60 * this.minutes(n);
    this.days    = (n: int): int => 24 * this.hours(n);
  }
}

export const evmTimestamp = (...dateFields): int =>
  new Date(dateFields).getTime() / 1000;
