export function formatDateTimeMinute(
  value: string | number | Date | null | undefined,
  fallback = ''
): string {
  if (value === null || value === undefined || value === '') return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mi = pad2(date.getMinutes())
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
