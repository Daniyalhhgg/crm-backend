const FIXED_TIME_SLOTS = [
  { label: "3 PM - 5 PM", startTime: "15:00", endTime: "17:00" },
  { label: "5 PM - 7 PM", startTime: "17:00", endTime: "19:00" },
  { label: "7 PM - 9 PM", startTime: "19:00", endTime: "21:00" },
];

const AUDITORIUM_TIME_SLOTS = [
  { label: "Full Day Booking", startTime: "09:00", endTime: "17:00" },
  { label: "10 AM - 12 PM", startTime: "10:00", endTime: "12:00" },
  { label: "2 PM - 4 PM", startTime: "14:00", endTime: "16:00" },
  { label: "6 PM - 8 PM", startTime: "18:00", endTime: "20:00" },
];

const CATEGORY_TIME_SLOTS = {
  "Hi-Tea Buffet": FIXED_TIME_SLOTS,
  "Dinner Buffet": [
    { label: "7 PM - 8:30 PM", startTime: "19:00", endTime: "20:30" },
    { label: "9 PM - 10:30 PM", startTime: "21:00", endTime: "22:30" },
  ],
  Wedding: [
    { label: "1 PM - 4 PM", startTime: "13:00", endTime: "16:00" },
    { label: "7 PM - 10 PM", startTime: "19:00", endTime: "22:00" },
  ],
  "Auditorium / Movie Night + Hi-Tea": AUDITORIUM_TIME_SLOTS,
};

const parseTime = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();
  if (minute > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
  if (meridiem) hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
  return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, minutes: hour * 60 + minute };
};

function parseConfiguredTimeSlots(labels) {
  if (!Array.isArray(labels) || !labels.length || labels.length > 30) return null;
  const slots = [];
  for (const rawLabel of labels) {
    if (typeof rawLabel !== "string" || !rawLabel.trim() || rawLabel.trim().length > 120) return null;
    const range = rawLabel.trim().match(/^(.+?)\s+(?:to|[-–—])\s+(.+)$/i);
    if (!range) return null;
    const start = parseTime(range[1]);
    const end = parseTime(range[2]);
    if (!start || !end || end.minutes <= start.minutes) return null;
    slots.push({ label: rawLabel.trim(), startTime: start.value, endTime: end.value, startMinutes: start.minutes, endMinutes: end.minutes });
  }
  slots.sort((a, b) => a.startMinutes - b.startMinutes);
  if (slots.some((slot, index) => index > 0 && slot.startMinutes < slots[index - 1].endMinutes)) return null;
  return slots.map(({ label, startTime, endTime }) => ({ label, startTime, endTime }));
}

const toMinutes = (time) => {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
};

function getCategoryTimeSlots(category = "Hi-Tea Buffet", configuredLabels = []) {
  if (["Hi-Tea Buffet", "Dinner Buffet", "Wedding"].includes(category)) {
    const configured = parseConfiguredTimeSlots(configuredLabels);
    if (configured) return configured;
  }
  return CATEGORY_TIME_SLOTS[category] || FIXED_TIME_SLOTS;
}

function getFixedTimeSlots(savedSlots = [], dayStatus = "available", category = "Hi-Tea Buffet", configuredLabels = []) {
  const fixedSlots = getCategoryTimeSlots(category, configuredLabels);
  const unused = [...savedSlots];
  return fixedSlots.map((fixed) => {
    const exactIndex = unused.findIndex((slot) => slot.startTime === fixed.startTime && slot.endTime === fixed.endTime);
    let saved;
    if (exactIndex >= 0) {
      [saved] = unused.splice(exactIndex, 1);
    } else {
      const fixedStart = toMinutes(fixed.startTime);
      const fixedEnd = toMinutes(fixed.endTime);
      let bestIndex = -1;
      let bestOverlap = 0;
      unused.forEach((slot, index) => {
        const overlap = Math.max(
          0,
          Math.min(fixedEnd, toMinutes(slot.endTime)) - Math.max(fixedStart, toMinutes(slot.startTime))
        );
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0) [saved] = unused.splice(bestIndex, 1);
    }

    return {
      ...(saved?._id ? { _id: saved._id } : {}),
      ...fixed,
      status: dayStatus === "full" ? "full" : saved?.status || dayStatus,
      note: saved?.note || "",
      capacity: Math.max(0, Number(saved?.capacity) || 0),
      booked: Math.max(0, Number(saved?.booked) || 0),
    };
  });
}

module.exports = { FIXED_TIME_SLOTS, AUDITORIUM_TIME_SLOTS, CATEGORY_TIME_SLOTS, parseConfiguredTimeSlots, getCategoryTimeSlots, getFixedTimeSlots };
