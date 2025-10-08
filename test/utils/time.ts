export const Duration = {
  minutes: (n: number): number => 60 * n,
  hours:   (n: number): number => 60 * Duration.minutes(n),
  days:    (n: number): number => 24 * Duration.hours(n),
};

export const evmTimestamp = (
  year: number,
  month: number,
  day: number = 1,
): number => Math.floor(new Date(year, month - 1, day).getTime() / 1000);
