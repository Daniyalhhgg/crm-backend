/**
 * Parse a date string + time string into a JS Date (PKT = UTC+5)
 *
 * @param {string} date  - "2026-05-25"
 * @param {string} time  - "10:00 AM" | "14:30" | "2:30 PM"
 * @returns {Date}
 */
function parseReminderDateTime(date, time) {
  if (typeof date !== "string" || typeof time !== "string") {
    throw new Error("Date and time must be strings");
  }
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) throw new Error("Date must use YYYY-MM-DD");
  const year = Number(dateMatch[1]);
  if (year < 2020 || year > 2100) throw new Error("Date year must be between 2020 and 2100");
  const dateCheck = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== date) {
    throw new Error("Date is invalid");
  }

  const timeMatch = time.trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)?$/i);
  if (!timeMatch) throw new Error("Time must use HH:mm or h:mm AM/PM");
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toUpperCase();

  if (meridiem) {
    if (hours < 1 || hours > 12) throw new Error("12-hour time must be between 1 and 12");
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  } else if (hours > 23) {
    throw new Error("24-hour time must be between 00:00 and 23:59");
  }

  const iso = `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+05:00`;
  return new Date(iso);
}

module.exports = { parseReminderDateTime };
