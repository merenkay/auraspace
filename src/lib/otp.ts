/**
 * Pure helpers for the six-box one-time-code input (components/AuthLayout.tsx → CodeInput).
 * The code is kept as one contiguous digit string (no gaps), at most `length` long.
 */

export const OTP_LENGTH = 6

export const onlyDigits = (s: string) => s.replace(/\D/g, '')

/**
 * Put `incoming` digits into the code starting at box `index`, overwriting what is there.
 * A string carrying a whole code (>= length digits) replaces the code wherever it lands.
 * Returns the new code and the box that should get focus next (after the last filled box, or the last box).
 */
export function fillDigits(code: string, index: number, incoming: string, length = OTP_LENGTH): { code: string; focus: number } {
  const cur = onlyDigits(code).slice(0, length)
  const inc = onlyDigits(incoming)
  if (!inc) return { code: cur, focus: Math.min(index, length - 1) }
  if (inc.length >= length) return { code: inc.slice(0, length), focus: length - 1 }
  const at = Math.max(0, Math.min(index, cur.length))
  const next = (cur.slice(0, at) + inc + cur.slice(at + inc.length)).slice(0, length)
  return { code: next, focus: Math.min(at + inc.length, length - 1) }
}

/**
 * Work out which digits the user entered into one box, given the box's raw value after the change.
 * A box that already held `old` and received one keystroke has two characters; the new one sits just
 * before the caret. Anything longer is a paste or OS autofill and is returned whole.
 */
export function enteredDigits(raw: string, old: string | undefined, caret: number | null): string {
  if (old && raw.length === 2) {
    const ch = caret != null && caret > 0 ? raw[caret - 1] : raw[raw.length - 1]
    return onlyDigits(ch ?? '') || onlyDigits(raw.replace(old, ''))
  }
  // Autofill / paste on a filled box: drop the old digit if it was kept in front of or behind the new text.
  const d = onlyDigits(raw)
  if (old && d.length === OTP_LENGTH + 1) return d.startsWith(old) ? d.slice(1) : d.slice(0, OTP_LENGTH)
  return d
}

/** Backspace in box `index`: clear a filled box (later digits close the gap), or clear the previous box from an empty one. */
export function backspaceAt(code: string, index: number): { code: string; focus: number } {
  const cur = onlyDigits(code)
  if (cur[index]) return { code: cur.slice(0, index) + cur.slice(index + 1), focus: index }
  if (index <= 0) return { code: cur, focus: 0 }
  const prev = Math.min(index - 1, cur.length - 1)
  if (prev < 0) return { code: cur, focus: 0 }
  return { code: cur.slice(0, prev) + cur.slice(prev + 1), focus: prev }
}
