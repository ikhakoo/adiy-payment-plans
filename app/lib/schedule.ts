// Pure schedule math. Everything is in integer cents so rounding is explicit.

export const toCents = (value: string | number | { toString(): string }) =>
  Math.round(Number(value.toString()) * 100);

export const fromCents = (cents: number) => (cents / 100).toFixed(2);

export interface ScheduledInstallment {
  seq: number;
  dueDate: Date;
  amountCents: number;
}

/** Same day-of-month `months` later, clamped to the month's last day (Jan 31 → Feb 28). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Splits what's still owed after checkout into the remaining monthly installments.
 * Installment 1 is whatever was paid at checkout; 2..count share the outstanding balance
 * evenly, with the last one absorbing the leftover cents so the total is exact.
 */
export function buildSchedule(opts: {
  checkoutPaidCents: number;
  outstandingCents: number;
  count: number;
  startDate: Date;
  intervalMonths?: number;
}): ScheduledInstallment[] {
  const { checkoutPaidCents, outstandingCents, count, startDate } = opts;
  const intervalMonths = opts.intervalMonths ?? 1;
  if (count < 2) throw new Error("A payment plan needs at least 2 installments");
  if (outstandingCents < 0) throw new Error("Outstanding balance can't be negative");

  const remaining = count - 1;
  const base = Math.floor(outstandingCents / remaining);
  const schedule: ScheduledInstallment[] = [
    { seq: 1, dueDate: new Date(startDate), amountCents: checkoutPaidCents },
  ];
  for (let i = 1; i <= remaining; i++) {
    schedule.push({
      seq: i + 1,
      dueDate: addMonths(startDate, i * intervalMonths),
      amountCents:
        i === remaining ? outstandingCents - base * (remaining - 1) : base,
    });
  }
  return schedule;
}

/**
 * Re-spreads a new outstanding balance over the installments that haven't been paid yet,
 * keeping their due dates. Used after an order edit, partial refund or early partial payment.
 */
export function respread(
  unpaid: { seq: number; dueDate: Date }[],
  outstandingCents: number,
): ScheduledInstallment[] {
  if (unpaid.length === 0) return [];
  const base = Math.floor(outstandingCents / unpaid.length);
  return unpaid.map((inst, i) => ({
    seq: inst.seq,
    dueDate: inst.dueDate,
    amountCents:
      i === unpaid.length - 1
        ? outstandingCents - base * (unpaid.length - 1)
        : base,
  }));
}

/** When to retry after the Nth failed attempt, or null when retries are exhausted. */
export function nextRetryDate(
  failedAt: Date,
  attempts: number,
  retryDays: number[],
): Date | null {
  const days = retryDays[attempts - 1];
  if (days === undefined) return null;
  return new Date(failedAt.getTime() + days * 24 * 60 * 60 * 1000);
}
