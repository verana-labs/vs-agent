/**
 * `JSON.stringify` replacement intended for logging. Unlike `JSON.stringify`, it
 * bounds the size of the produced string so a single large field (e.g. a base64
 * profile picture) cannot dump tens of kilobytes into the logs on every message.
 *
 * It does two things while serializing:
 * - Redacts values of known heavy fields (image/attachment data), replacing them
 *   with a short placeholder that keeps the original length as a hint.
 * - Truncates any remaining long string value to `maxStringLength` characters.
 *
 * @param value - The value to serialize.
 * @param options.maxStringLength - Max length of any individual string value before
 *   it is truncated. Defaults to 1000.
 * @param options.redactKeys - Object keys whose string values should be redacted
 *   regardless of length. Defaults to common heavy media fields.
 * @returns A JSON string safe to write to logs.
 */
export function safeStringify(
  value: unknown,
  options?: { maxStringLength?: number; redactKeys?: string[] },
): string {
  const maxStringLength = options?.maxStringLength ?? 1000
  const redactKeys = new Set(
    options?.redactKeys ?? ['displayImageUrl', 'displayPicture', 'displayIcon', 'base64', 'data', '~attach'],
  )

  const truncate = (str: string): string =>
    str.length > maxStringLength ? `${str.slice(0, maxStringLength)}… [${str.length} chars total]` : str

  try {
    return JSON.stringify(value, function (key, val) {
      if (redactKeys.has(key)) {
        if (typeof val === 'string') return `[redacted ${val.length} chars]`
        if (val && typeof val === 'object') return '[redacted]'
      }
      if (typeof val === 'string') return truncate(val)
      return val
    })
  } catch {
    // Fallback for circular structures or values that JSON cannot serialize.
    return String(value)
  }
}
