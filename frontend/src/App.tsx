import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Loading } from './components/g/parts'
import { Icon } from './components/g/Icon'
import Dashboard from './pages/Dashboard'

const Allocations = lazy(() => import('./pages/Allocations'))
const AllBeds = lazy(() => import('./pages/AllBeds'))
const Patients = lazy(() => import('./pages/Patients'))
const AI = lazy(() => import('./pages/AI'))
const Equipment = lazy(() => import('./pages/Equipment'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Reports = lazy(() => import('./pages/Reports'))
const Setup = lazy(() => import('./pages/Setup'))
const Settings = lazy(() => import('./pages/Settings'))

function NotFound() {
  return (
    <div className="page"><section className="card page-error">
      <Icon name="info" />
      <h2>This page doesn’t exist</h2>
      <Link className="btn primary" to="/">Back to Dashboard</Link>
    </section></div>
  )
}

/** Old links keep working: the 3D Explorer became Bed Allocations. */
function Legacy({ to }: { to: string }) {
  const loc = useLocation()
  return <Navigate replace to={`${to}${loc.search}`} />
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Suspense fallback={<div className="page"><Loading /></div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/allocations" element={<Allocations />} />
            <Route path="/beds" element={<AllBeds />} />
            <Route path="/patients" element={<Patients />} />
            <Route path="/ai" element={<AI />} />
            <Route path="/equipment" element={<Equipment />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/explorer" element={<Legacy to="/allocations" />} />
            <Route path="/dashboard" element={<Legacy to="/" />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  )
}
