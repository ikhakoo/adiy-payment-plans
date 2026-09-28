export const formatMoney = (amount: string | number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));

export const statusTone = (status: string) =>
  (
    ({
      ACTIVE: "info",
      PAST_DUE: "warning",
      DEFAULTED: "critical",
      PAUSED: "neutral",
      COMPLETED: "success",
      CANCELLED: "neutral",
      PAID: "success",
      FAILED: "critical",
      PROCESSING: "info",
      SCHEDULED: "neutral",
      SKIPPED: "neutral",
      WAIVED: "neutral",
    }) as Record<string, "info" | "warning" | "critical" | "neutral" | "success">
  )[status] ?? "neutral";
