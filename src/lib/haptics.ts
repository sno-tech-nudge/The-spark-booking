// A short buzz on phones that support it (Android Chrome, installed PWAs).
// iPhones ignore the Vibration API, so this quietly does nothing there.
export function buzz(pattern: number | number[] = [35, 45, 70]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // never let a buzz break a booking
  }
}
