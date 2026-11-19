const MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: "Please sign in first.",
  TAKEN: "Just taken — someone else got this a moment ago. Pick another.",
  ALREADY_HAVE_DESK: "You already have a desk for this time.",
  SEAT_ASSIGNED: "This seat is assigned to a Fixed Desk member.",
  UNKNOWN_SEAT: "That seat doesn't exist.",
  UNKNOWN_ROOM: "That room doesn't exist.",
  PAST_DATE: "That date has passed.",
  TOO_FAR: "That's too far ahead to book yet.",
  CLOSED_SUNDAY: "The centre is closed on Sundays.",
  SLOT_OVER: "That time has already passed.",
  MEMBERS_ONLY: "Rooms are for members only. Day passes don't include room access.",
  BAD_DURATION: "Pick a duration between 1 and 9 hours.",
  ON_THE_HOUR: "Room bookings start on the hour.",
  NOT_ALLOWED: "You can't change this booking.",
  NOT_ACTIVE: "This booking is no longer active.",
  NOT_CONFIRMED: "Only confirmed bookings can be checked in.",
  NOT_TODAY: "You can check in on the day of your booking.",
  NOT_CHECKED_IN: "Check in first.",
  HAS_BOOKINGS: "There are bookings on that day — cancel or move them first.",
  NOT_FOUND: "Booking not found.",
};

export function friendlyError(raw: unknown): string {
  const msg = typeof raw === "string" ? raw : (raw as { message?: string })?.message ?? String(raw);
  const closed = msg.match(/CLOSED\|(.+)$/);
  if (closed) return `Closed that day: ${closed[1]}`;
  const min = msg.match(/MIN_HOURS_(\d+)/);
  if (min) return `This room needs at least ${min[1]} hours.`;
  const hrs = msg.match(/OUTSIDE_HOURS_(\d+)_(\d+)/);
  if (hrs) return `Your plan can book rooms between ${fmt(+hrs[1])} and ${fmt(+hrs[2])}.`;
  for (const code of Object.keys(MESSAGES)) {
    if (msg.includes(code)) return MESSAGES[code];
  }
  return msg || "Something went wrong.";
}

function fmt(h: number) {
  return h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`;
}
