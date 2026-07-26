import { useCallback, useState } from 'react'

/**
 * Selected-types state for a multi-select `TypeFilter` (Story #73). Holds the active set,
 * a toggle that adds or removes one type, and a clear that empties it. Shared by the trades
 * and dividends tables so both get identical multi-select behaviour; an empty set is the
 * "no filter" state that `filterByTypes` reads as "show all rows".
 */
export function useTypeSelection(): {
  selected: ReadonlySet<string>
  toggle: (type: string) => void
  clear: () => void
} {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = useCallback((type: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const clear = useCallback((): void => setSelected(new Set()), [])

  return { selected, toggle, clear }
}
