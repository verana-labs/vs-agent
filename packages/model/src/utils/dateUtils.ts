/**
 * Converts a Machine Readable Travel Document (MRTD) date from `YYMMDD` to `YYYYMMDD`,
 * inferring the century based on the current year and the date type.
 *
 * - **Expiration dates:** Assumes a maximum of 10 years into the future (passport validity window).
 *   Years beyond that threshold are interpreted as the previous century.
 * - **Birth dates:** Never resolved to a future year — if the candidate year exceeds
 *   the current year, it falls back to the previous century.
 *
 * @param {string} date - The MRTD date string in the format `YYMMDD`.
 * @param {boolean} isExpirationDate - A boolean flag indicating whether the date is an expiration date.
 * @returns {string} - The converted date in the format `YYYYMMDD`, or the original input
 *                     if the input is not a valid `YYMMDD` date.
 *
 * @example
 * // Current year: 2026
 * convertShortDate("350531", true);   // "20350531" — within 10-year window
 * convertShortDate("990531", false);  // "19990531" — birth date, previous century
 * convertShortDate("abcd12", true);   // undefined  — invalid format
 * convertShortDate(null, true);       // undefined
 */
export function convertShortDate(date: string | null | undefined, isExpirationDate: boolean) {
  if (!date || !/^\d{6}$/.test(date)) return date ?? undefined

  const currentYear = new Date().getFullYear()
  const year = Math.floor(currentYear / 100) * 100 + parseInt(date.slice(0, 2), 10)

  let fullYear: number

  if (isExpirationDate) {
    fullYear = year > currentYear + 10 ? year - 100 : year
  } else {
    fullYear = year > currentYear ? year - 100 : year
  }
  return `${fullYear}${date.slice(2)}`
}

// Local helper: credo-ts/didcomm’s DateParser isn’t a public export; importing from build/* breaks bundlers/resolvers.
export const DateParser = (value: unknown) => {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed
  }
  return value
}
