export function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDateTimeDDMMYYYY(
  input?: string | number | Date,
  opts?: { includeTime?: boolean; timeZone?: string }
): string | undefined {
  if (!input) return undefined;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return undefined;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(opts?.includeTime
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
    timeZone: opts?.timeZone,
  } as Intl.DateTimeFormatOptions);
  return fmt.format(date);
}
