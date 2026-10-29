/* MediTwin AI assistant — right-side Graphite drawer (.drawer / .drawer-backdrop / .drawer-body from extras.css). */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { errorMessage, useAction, useMeta } from '../lib/queries'
import type { AssistantCard, AssistantReply } from '../lib/types'
import { useUI } from '../lib/ui'
import { Icon } from './g/Icon'
import { ScoreBadge, Spinner } from './g/parts'
import '../styles/pages/AI.css'

interface Msg { role: 'user' | 'assistant'; content: string; cards?: AssistantCard[]; error?: boolean; engine?: string; suggestions?: string[] }

const STARTERS = [
  'How many beds are free right now?',
  'Plan beds for the whole queue',
  'Where should P-9003 go?',
  'Are we short on ventilators?',
  'Which ward will be under pressure today?',
  'Show free ICU beds',
]

/** Renders **bold**, `code`, headings and bullet lines from the assistant's plain-text replies. */
function RichText({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={i} className="code">{part.slice(1, -1)}</code>
      return <Fragment key={i}>{part}</Fragment>
    })
  return (
    <div className="ai-rich">
      {text.split('\n').map((ln, i) => {
        const t = ln.trim()
        if (!t) return <div key={i} className="ai-gap" />
        if (/^[•\-*]\s/.test(t)) return <div key={i} className="ai-bullet"><span aria-hidden="true">•</span><span>{inline(t.replace(/^[•\-*]\s/, ''))}</span></div>
        if (/^#{1,3}\s/.test(t)) return <div key={i} className="ai-rich-h">{inline(t.replace(/^#{1,3}\s/, ''))}</div>
        return <p key={i}>{inline(t)}</p>
      })}
    </div>
  )
}

function Card({ card, onDone }: { card: AssistantCard; onDone: () => void }) {
  const nav = useNavigate()
  const ui = useUI()
  const [done, setDone] = useState(false)
  const alloc = useAction(() => api.allocate(card.patient_id!, card.bed_id!), {
    success: (r) => `${r.bed_code} allocated to ${r.patient_code}.`,
    onSuccess: () => setDone(true),
  })
  if (card.kind === 'ALLOCATION') {
    return (
      <div className="rec-card ai-proposal">
        <div className="rc-top">
          <ScoreBadge score={card.score ?? 0} />
          <div className="rc-id">
            <strong>
              {card.patient_id ? <button className="link strong code" onClick={() => { onDone(); ui.openPatient(card.patient_id!) }}>{card.patient_code}</button> : <span className="code">{card.patient_code}</span>}
              {' → '}<span className="code">{card.bed_code}</span>
            </strong>
            <small>{card.ward_name}{card.devices?.length ? ` · ${card.devices.join(', ')}` : ''}</small>
          </div>
          {done ? (
            <span className="chip st-AVAILABLE"><i aria-hidden="true" />Allocated</span>
          ) : (
            <button className="btn sm primary" onClick={() => alloc.mutate(undefined)} disabled={alloc.isPending || !card.patient_id || !card.bed_id}>
              {alloc.isPending ? <Spinner /> : <Icon name="check" />}Confirm
            </button>
          )}
        </div>
        {card.reasons && card.reasons.length > 0 && <ul className="rc-why">{card.reasons.map((r) => <li key={r}><Icon name="check" />{r}</li>)}</ul>}
        <p className="muted ai-fine">Staff confirmation required. The server rechecks the bed before saving.</p>
      </div>
    )
  }
  const link = (label: string, icon: string, to: string) => (
    <button className="btn sm ai-card-link" onClick={() => { onDone(); nav(to) }}><Icon name={icon} />{label}</button>
  )
  if (card.kind === 'OPEN_PLAN') return link(`Review AI plan (${card.placed ?? 0}/${card.waiting ?? 0})`, 'wand', '/ai?tab=plan')
  if (card.kind === 'OPEN_FORECAST') return link('Open capacity forecast', 'trend', '/ai?tab=forecast')
  if (card.kind === 'OPEN_WARD' && card.ward_id != null) return link(`Open ${card.ward_name ?? 'ward'} in Bed Allocations`, 'cube', `/allocations?ward=${card.ward_id}`)
  if (card.kind === 'BED' && card.ward_id != null && card.bed_id != null) return link(`Open ${card.bed_code ?? 'bed'}`, 'bed', `/allocations?ward=${card.ward_id}&bed=${card.bed_id}`)
  return null
}

export function AssistantPanel({ open, onClose, prompt, nonce }: { open: boolean; onClose: () => void; prompt?: string; nonce: number }) {
  const meta = useMeta()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastNonce = useRef(0)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: t }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const r: AssistantReply = await api.assistant(next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })))
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply + (r.notice ? `\n\n${r.notice}` : ''), cards: r.cards, engine: r.engine, suggestions: r.suggestions }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: errorMessage(e), error: true }])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (open && prompt && !busy && nonce !== lastNonce.current) {
      lastNonce.current = nonce
      void send(prompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prompt, nonce, busy])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs, busy, open])

  // focus, Escape and focus trap while open; focus returns to the opener on close
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => (inputRef.current ?? panelRef.current)?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return // a dialog on top handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key === 'Tab' && panelRef.current) {
        const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, textarea, input, a[href]')).filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent)
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      if (prev && document.contains(prev)) prev.focus()
    }
  }, [open])

  if (!open) return null
  const engine = meta.data ? (meta.data.ai_engine === 'groq' ? `Groq · ${meta.data.ai_model ?? 'gpt-oss-120b'}` : 'Built-in engine · offline') : 'Connecting…'
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
  const suggestions = !busy && lastAssistant && !lastAssistant.error ? (lastAssistant.suggestions ?? []).slice(0, 3) : []

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside ref={panelRef} className="drawer ai-drawer" role="dialog" aria-modal="true" aria-label="MediTwin AI assistant" tabIndex={-1}>
        <header>
          <div className="ai-avatar brand-avatar" aria-hidden="true"><img src="/brand/logo-mark.png" alt="" /></div>
          <div className="ai-drawer-title">
            <strong>MediTwin AI</strong>
            <small className="muted">{engine} · reads live hospital data</small>
          </div>
          {msgs.length > 0 && <button className="btn ghost sm" onClick={() => { setMsgs([]); inputRef.current?.focus() }} disabled={busy}>Clear</button>}
          <button className="icon-btn plain" onClick={onClose} aria-label="Close assistant"><Icon name="x" /></button>
        </header>

        <div className="drawer-body" aria-live="polite">
          {msgs.length === 0 && (
            <div className="ai-welcome">
              <h2>What do you need to know?</h2>
              <p className="muted">Ask about free beds, equipment, the queue, or where to place a patient. I can propose allocations — you confirm them.</p>
              <div className="quick ai-starters">
                {STARTERS.map((s) => (
                  <button key={s} className="qa" onClick={() => void send(s)} disabled={busy}><Icon name="spark" />{s}</button>
                ))}
              </div>
            </div>
          )}
          <div className="ai-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'user' ? (
                  <div className="ai-bubble">{m.content}</div>
                ) : (
                  <div className="ai-reply">
                    {m.error && <span className="err"><Icon name="alert" />Couldn’t answer</span>}
                    <RichText text={m.content} />
                    {m.cards?.map((c, j) => <Card key={j} card={c} onDone={onClose} />)}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="loading-line"><Spinner />Reading live data…</div>}
            {suggestions.length > 0 && (
              <div className="ai-suggest">
                {suggestions.map((s) => <button key={s} className="pf-tab" onClick={() => void send(s)}>{s}</button>)}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <footer>
          <form className="ai-compose" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
            <label htmlFor="ai-input" className="sr-only">Message MediTwin AI</label>
            <textarea
              id="ai-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
              rows={1}
              placeholder="Ask MediTwin AI…"
            />
            <button type="submit" className="btn primary ai-send" disabled={!input.trim() || busy} aria-label="Send message">
              {busy ? <Spinner /> : <Icon name="arrowup" />}
            </button>
          </form>
          <p className="muted ai-fine center">Resource decision support on fictional data — not clinical advice.</p>
        </footer>
      </aside>
    </>,
    document.body,
  )
}
