/**
 * True on a phone, including landscape and "Request Desktop Website".
 * Those modes are wider than 760px and can report a fine pointer, so
 * width alone misses them. A missed phone plays video clips over the
 * preview, and the clips flash black.
 */
export function isPhoneLayout(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(max-width: 760px)").matches) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;

  const ua = navigator.userAgent;
  if (/iPhone|iPod|Android.+Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }

  const shortSide = Math.min(window.screen.width, window.screen.height);
  return navigator.maxTouchPoints > 0 && shortSide > 0 && shortSide <= 900;
}
