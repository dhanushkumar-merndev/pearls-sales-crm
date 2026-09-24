export function formatHospitalDate(value: Date | string, withTime = false) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function formatTokenNumber(value: number) {
  if (!Number.isInteger(value) || value < 1)
    throw new Error("Invalid token number.");
  return String(value);
}

export function calculateAge(dob: string, now = new Date()) {
  const birth = new Date(`${dob}T00:00:00Z`);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() &&
      now.getUTCDate() < birth.getUTCDate())
  )
    age -= 1;
  return Math.max(0, age);
}

export function minutesSince(value: string, now = new Date()) {
  return Math.max(
    0,
    Math.round((now.getTime() - new Date(value).getTime()) / 60000),
  );
}

/**
 * Waiting time in words: "just now", "12 min", "2 h 38 m", "1 d 4 h".
 *
 * Raw minutes stopped being readable once a patient had been waiting a couple
 * of hours -- "158 min" makes the reader do arithmetic. The value is a plain
 * elapsed duration between two instants, so no timezone is involved:
 * created_at is a timestamptz and both sides are compared as absolute times.
 */
export function formatWaitingTime(value: string, now = new Date()) {
  const minutes = minutesSince(value, now);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} h ${restMinutes} m` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

export function ipDaysSince(value: string, now = new Date()) {
  return Math.max(1, Math.ceil((now.getTime() - new Date(value).getTime()) / 86400000));
}

export function isHospitalToday(value: Date | string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata" });
  return formatter.format(new Date(value)) === formatter.format(now);
}
