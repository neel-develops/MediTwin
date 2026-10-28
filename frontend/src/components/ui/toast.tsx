/* Toasts with the design commit's markup: .toasts > .toast.ok|.err|.info */
import { useEffect, useState } from 'react'
import { Icon } from '../g/Icon'

type Kind = 'ok' | 'err' | 'info'
interface T { id: number; kind: Kind; text: string; out?: boolean }

let items: T[] = []
let seq = 0
const listeners = new Set<(t: T[]) => void>()
const emit = () => listeners.forEach((l) => l([...items]))

function push(kind: Kind, text: string) {
  const id = ++seq
  items = [...items.slice(-3), { id, kind, text }]
  emit()
  const life = kind === 'err' ? 6500 : 3500
  window.setTimeout(() => { items = items.map((t) => (t.id === id ? { ...t, out: true } : t)); emit() }, life)
  window.setTimeout(() => { items = items.filter((t) => t.id !== id); emit() }, life + 450)
}

export const toast = {
  success: (t: string) => push('ok', t),
  error: (t: string) => push('err', t),
  info: (t: string) => push('info', t),
}

export function Toaster() {
  const [list, setList] = useState<T[]>([])
  useEffect(() => {
    listeners.add(setList)
    return () => void listeners.delete(setList)
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.out ? 'out' : ''}`}>
          <Icon name={t.kind === 'err' ? 'alert' : t.kind === 'info' ? 'info' : 'check'} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
