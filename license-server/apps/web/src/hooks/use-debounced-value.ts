import { useEffect, useState } from 'react'

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Used to debounce search inputs so each keystroke does NOT fire its
 * own API request (and, server-side, its own `ILIKE '%q%'` telemetry scan).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
