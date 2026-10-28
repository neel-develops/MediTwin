/* 3D bed stage for the design's Bed Allocations layout: .stage-wrap > .stage plus the overlay UI the page
   floats on top (title, chips, tools, banner). The camera fit and section labels avoid those overlays. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createStage, webglAvailable, type SceneBed, type Stage } from '../scene/bedScene'

const OVERLAYS = '.cx-title, .cx-chips, .cx-tools, .place-banner:not([hidden])'

export function BedStage({
  beds, selectedId, focusId, matchIds, activeGroup, groupSize, onBedClick, onGroupClick, resetKey, onUnavailable,
  stageRef, listMode = false, placing = false, refitKey, children, list,
}: {
  beds: SceneBed[]
  /** Bed shown as selected (ring + tag). */
  selectedId: number | null
  /** Bed the camera should fly to when it changes (an explicit selection, not the default one). */
  focusId: number | null
  matchIds: Set<number> | null
  activeGroup: number | null
  groupSize: number
  onBedClick: (id: number) => void
  onGroupClick: (i: number) => void
  /** The camera resets when this key changes (ward id + group size). */
  resetKey: string
  onUnavailable: () => void
  stageRef?: { current: Stage | null }
  listMode?: boolean
  placing?: boolean
  /** Re-fit the camera when overlays may have changed size (banner, wrapping chips). */
  refitKey?: string
  /** Overlay UI drawn on top of the stage. */
  children?: ReactNode
  list?: ReactNode
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const cb = useRef({ onBedClick, onGroupClick, onUnavailable })
  cb.current = { onBedClick, onGroupClick, onUnavailable }
  const [ready, setReady] = useState(false)
  const lastKey = useRef('')
  const lastFocus = useRef<number | null>(null)
  const clicked = useRef<number | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    if (!webglAvailable()) {
      cb.current.onUnavailable()
      return
    }
    try {
      stage.current = createStage(el, {
        onBedClick: (id) => {
          clicked.current = id // picked in 3D: no camera jump
          cb.current.onBedClick(id)
        },
        onGroupClick: (i) => cb.current.onGroupClick(i),
        obstacles: () => {
          const base = el.getBoundingClientRect()
          return Array.from(wrap.current?.querySelectorAll(OVERLAYS) ?? [])
            .map((n) => n.getBoundingClientRect())
            .filter((r) => r.width && r.height)
            .map((r) => ({ l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top }))
        },
      })
      if (stageRef) stageRef.current = stage.current
      setReady(true)
    } catch {
      cb.current.onUnavailable()
    }
    return () => {
      stage.current?.dispose()
      stage.current = null
      if (stageRef) stageRef.current = null
      lastKey.current = ''
      lastFocus.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Same order as her update(): beds → match → section → selection.
  useEffect(() => {
    const s = stage.current
    if (!s || !ready) return
    s.setBeds(beds, { groupSize, resetView: lastKey.current !== resetKey })
    if (beds.length) lastKey.current = resetKey
    s.setMatch(matchIds)
    s.setActiveGroup(activeGroup)
    // Fly to an explicit selection once its bed is in the scene (deep links, search, strip, list).
    const inScene = focusId != null && beds.some((b) => b.id === focusId)
    const changed = focusId !== lastFocus.current
    s.select(selectedId, { focus: changed && inScene && focusId !== clicked.current })
    if (focusId == null || inScene) {
      if (changed) clicked.current = null
      lastFocus.current = focusId
    }
  }, [ready, beds, groupSize, resetKey, matchIds, activeGroup, selectedId, focusId])

  // The header may change height (banner, wrapping chips): keep the fit clear of it.
  useEffect(() => {
    if (ready) stage.current?.refit()
  }, [ready, refitKey])
  useEffect(() => {
    const w = wrap.current
    if (!w || !ready) return
    const ro = new ResizeObserver(() => stage.current?.refit())
    w.querySelectorAll(OVERLAYS).forEach((n) => ro.observe(n))
    return () => ro.disconnect()
  }, [ready, refitKey])

  return (
    <div ref={wrap} className={`stage-wrap ${listMode ? 'list-mode' : ''} ${placing ? 'placing' : ''}`}>
      <div ref={host} className="stage" tabIndex={0} role="application"
        aria-label="3D bed grid. Drag to rotate, right-drag or shift-drag to pan, scroll to zoom. Arrow keys rotate, plus and minus zoom. Use the List view for a non-3D alternative." />
      {children}
      <div className="stage-note">Display grid only — not physical bed locations</div>
      <div className="bed-list" hidden={!listMode}>{listMode ? list : null}</div>
    </div>
  )
}
