/* App shell from the Graphite design: floating glass rail (.sidenav), glass top bar (.topbar), scrolling <main>. */
import { useQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAlerts, useWards } from '../../lib/queries'
import { NAV_SECTION, ROUTE_TITLES, UIContext } from '../../lib/ui'
import { AssistantPanel } from '../AssistantPanel'
import { Icon } from '../g/Icon'
import { ConfirmHost } from '../g/Modal'
import { Chip } from '../g/parts'
import { PatientModal } from '../PatientModal'

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dash', end: true },
  { to: '/allocations', label: 'Bed Allocations', icon: 'bed' },
  { to: '/patients', label: 'Patients', icon: 'user' },
  { to: '/ai', label: 'AI Allocation', icon: 'spark' },
  { to: '/equipment', label: 'Equipment', icon: 'monitor' },
  { to: '/alerts', label: 'Alerts', icon: 'bell', badge: true },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/setup', label: 'Setup', icon: 'hospital' },
]

function useAttentionCount() {
  const alerts = useAlerts()
  return (alerts.data ?? []).filter((a) => a.severity !== 'info').length
}

function Sidenav({ onNavigate }: { onNavigate: () => void }) {
  const loc = useLocation()
  const section = NAV_SECTION[loc.pathname] ?? loc.pathname
  const n = useAttentionCount()
  return (
    <nav className="sidenav" id="sidenav" aria-label="Main">
      <Link className="brand" to="/" aria-label="MediTwin home — Dashboard" title="MediTwin · Smarter Hospital Resource Allocation" onClick={onNavigate}>
        <img className="brand-logo" src="/brand/logo-transparent.png" alt="" draggable={false} />
      </Link>
      {NAV.map((item) => {
        const active = item.end ? section === item.to : section === item.to || section.startsWith(`${item.to}/`)
        return (
          <NavLink key={item.to} to={item.to} end={item.end} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
            <Icon name={item.icon} />
            {item.label}
            {item.badge && n > 0 && <span className="nav-badge">{n}</span>}
          </NavLink>
        )
      })}
    </nav>
  )
}

function Crumbs() {
  const loc = useLocation()
  const [params] = useSearchParams()
  const wards = useWards()
  const path = loc.pathname
  const parts: ReactNode[] = [<Link key="h" to="/"><Icon name="hospital" />Hospital</Link>]
  if (NAV_SECTION[path]) parts.push(<Link key="s" to={NAV_SECTION[path]}>{ROUTE_TITLES[NAV_SECTION[path]]}</Link>)
  if (path !== '/') parts.push(<Link key="p" to={path}>{ROUTE_TITLES[path] ?? 'Not found'}</Link>)
  const wardId = params.get('ward')
  if (path === '/allocations' && wardId) {
    const w = wards.data?.find((x) => x.id === Number(wardId))
    if (w) parts.push(<span key="w" aria-current="page"><Icon name="layers" />{w.name}</span>)
  }
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {parts.map((p, i) => <Fragment key={i}>{i > 0 && <span className="sep" aria-hidden="true">›</span>}{p}</Fragment>)}
    </nav>
  )
}

function GlobalSearch() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const [term, setTerm] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 120)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const res = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: term.length > 0 })
  const items = useMemo(() => {
    const r = res.data
    if (!r) return []
    return [
      ...r.beds.map((b) => ({ label: b.bed_code, sub: `Bed · ${b.ward_name}`, status: b.status as string, go: () => nav(`/allocations?ward=${b.ward_id}&bed=${b.id}`) })),
      ...r.wards.map((w) => ({ label: w.name, sub: `Ward · prefix ${w.bed_code_prefix}`, status: '', go: () => nav(`/allocations?ward=${w.id}`) })),
      ...r.equipment.map((e) => ({ label: e.equipment_code, sub: `Equipment · ${e.equipment_type}`, status: e.status as string, go: () => nav(`/equipment?q=${encodeURIComponent(e.equipment_code)}`) })),
      ...r.patients.map((p) => ({ label: `${p.patient_code} · ${p.display_name}`, sub: 'Patient', status: p.status as string, go: () => nav(`/patients?patient=${p.id}`) })),
    ]
  }, [res.data, nav])
  const choose = (i: number) => {
    const it = items[i]
    if (!it) return
    setQ(''); setOpen(false); input.current?.blur(); it.go()
  }
  return (
    <div className="global-search" role="search">
      <label className="search-field">
        <span className="sr-only">Search beds, wards, equipment or patients</span>
        <Icon name="search" />
        <input ref={input} id="global-search" type="search" placeholder="Search bed, ward, equipment or patient…" autoComplete="off" value={q}
          role="combobox" aria-expanded={open && !!term} aria-controls="search-results"
          onChange={(e) => { setQ(e.target.value); setIdx(-1); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(idx >= 0 ? idx : 0) }
            else if (e.key === 'Escape') setOpen(false)
          }} />
      </label>
      {open && term && (
        <div className="search-results" id="search-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {items.length ? items.map((it, i) => (
            <button key={i} type="button" role="option" aria-selected={i === idx} className={`sr-item ${i === idx ? 'on' : ''}`} onClick={() => choose(i)}>
              <span><strong>{it.label}</strong><small>{it.sub}</small></span>{it.status ? <Chip status={it.status} /> : null}
            </button>
          )) : <div className="sr-empty">{res.isFetching ? 'Searching…' : `No beds, wards, equipment or patients match “${term}”.`}</div>}
        </div>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const loc = useLocation()
  const n = useAttentionCount()
  const [navOpen, setNavOpen] = useState(false)
  const [assistant, setAssistant] = useState<{ open: boolean; prompt?: string; nonce: number }>({ open: false, nonce: 0 })
  const [patientModal, setPatientModal] = useState<{ open: boolean; id?: number }>({ open: false })
  const title = ROUTE_TITLES[loc.pathname] ?? 'Not found'

  const ui = useMemo(() => ({
    openPatient: (id: number) => nav(`/patients?patient=${id}`),
    openAssistant: (prompt?: string) => setAssistant((a) => ({ open: true, prompt, nonce: a.nonce + 1 })),
    openRegister: () => setPatientModal({ open: true }),
    openEditPatient: (id: number) => setPatientModal({ open: true, id }),
  }), [nav])

  useEffect(() => { document.title = `${title} · MediTwin` }, [title])
  useEffect(() => { document.body.classList.toggle('nav-open', navOpen) }, [navOpen])
  useEffect(() => { setNavOpen(false) }, [loc.pathname])
  // Bed Allocations puts its ward tabs and bed search in the top bar (her body.route-allocations).
  useEffect(() => {
    document.body.classList.toggle('route-allocations', loc.pathname === '/allocations')
    return () => document.body.classList.remove('route-allocations')
  }, [loc.pathname])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAssistant((a) => ({ open: !a.open, nonce: a.nonce + 1 })) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <UIContext.Provider value={ui}>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="app">
        <header className="topbar">
          <div className="page-title"><strong id="page-title">{title}</strong><Crumbs /></div>
          <div className="topbar-slot" id="topbar-slot" />
          <GlobalSearch />
          <button className="icon-btn bell" onClick={() => ui.openAssistant()} aria-label="Ask MediTwin AI (Ctrl K)" title="Ask MediTwin AI (Ctrl K)">
            <Icon name="spark" />
          </button>
          <Link className="icon-btn bell" to="/alerts" aria-label={`Alerts (${n} need attention)`}>
            <Icon name="bell" />{n > 0 && <span className="badge">{n}</span>}
          </Link>
          <div className="user-chip" title="Staff"><span className="avatar" aria-hidden="true">DS</span></div>
          <button className="icon-btn menu-btn" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}><Icon name="list" /></button>
        </header>
        <Sidenav onNavigate={() => setNavOpen(false)} />
        <main id="main" tabIndex={-1}>{children}</main>
      </div>
      <AssistantPanel open={assistant.open} prompt={assistant.prompt} nonce={assistant.nonce} onClose={() => setAssistant((a) => ({ ...a, open: false }))} />
      <PatientModal open={patientModal.open} patientId={patientModal.id} onClose={() => setPatientModal({ open: false })}
        onSaved={(p, created) => { if (created) nav(`/patients?patient=${p.id}`) }} />
      <ConfirmHost />
    </UIContext.Provider>
  )
}
