export const PERFECT_WORLD_TIME_ZONE = "Europe/Moscow";

export function toGameDayKey(
  date = new Date(),
  timeZone = PERFECT_WORLD_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatHistoryDate(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

export function formatWeekday(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const value = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}
