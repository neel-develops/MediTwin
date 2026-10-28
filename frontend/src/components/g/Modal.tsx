/* Modal and confirm dialog with the design commit's markup (.modal-backdrop / .modal / header / .modal-body / footer). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export function Modal({ open, onClose, title, wide, children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  wide?: boolean
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => {
      const m = ref.current
      const first = m?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button.btn')
      ;(first ?? m)?.focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')).filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent)
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
      if (prev && document.contains(prev)) prev.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </>,
    document.body,
  )
}

/* ---------------- promise-based confirm, like the design's confirmDialog() */
interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }
type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }
let push: ((p: Pending) => void) | null = null

/** `if (await confirm({...})) doIt()` — rendered by <ConfirmHost/> in the app shell. */
export function confirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm(typeof opts.message === 'string' ? opts.message : opts.title))
    push({ ...opts, resolve })
  })
}

export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null)
  useEffect(() => {
    push = (x) => setP((cur) => { cur?.resolve(false); return x })
    return () => { push = null }
  }, [])
  const close = (ok: boolean) => { p?.resolve(ok); setP(null) }
  return (
    <Modal open={!!p} onClose={() => close(false)} title={p?.title ?? ''}
      footer={<>
        <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${p?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} data-autofocus>{p?.confirmLabel ?? 'Confirm'}</button>
      </>}>
      <p className="confirm-msg">{p?.message}</p>
    </Modal>
  )
}
