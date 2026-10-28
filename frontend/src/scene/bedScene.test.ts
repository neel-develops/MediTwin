import { describe, expect, it } from 'vitest'
import { computeLayout, groupName } from './bedScene'

const BED_W = 1.0
const BED_L = 2.0

describe('computeLayout', () => {
  it('places one position per bed in groups of the requested size', () => {
    const l = computeLayout(100, 10)
    expect(l.positions).toHaveLength(100)
    expect(l.groups).toHaveLength(10)
    expect(l.groups.reduce((n, g) => n + g.count, 0)).toBe(100)
  })

  it('never overlaps two beds (100-bed ward)', () => {
    const { positions } = computeLayout(100, 10)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j]
        const overlapX = Math.abs(a.x - b.x) < BED_W
        const overlapZ = Math.abs(a.z - b.z) < BED_L
        expect(overlapX && overlapZ).toBe(false)
      }
    }
  })

  it('keeps every bed inside its section tray', () => {
    const l = computeLayout(37, 8)
    l.positions.forEach((p) => {
      const g = l.groups[p.group]
      expect(p.x - BED_W / 2).toBeGreaterThanOrEqual(g.x - g.w / 2)
      expect(p.x + BED_W / 2).toBeLessThanOrEqual(g.x + g.w / 2)
      expect(p.z - BED_L / 2).toBeGreaterThanOrEqual(g.z - g.d / 2)
      expect(p.z + BED_L / 2).toBeLessThanOrEqual(g.z + g.d / 2)
    })
  })

  it('is deterministic and centred', () => {
    const a = computeLayout(64, 10)
    const b = computeLayout(64, 10)
    expect(a).toEqual(b)
    const xs = a.groups.map((g) => g.x)
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(1e-9)
  })

  it('handles empty and tiny wards', () => {
    expect(computeLayout(0, 10).positions).toHaveLength(0)
    expect(computeLayout(1, 10).groups).toHaveLength(1)
  })
})

describe('groupName', () => {
  it('labels sections A–Z then AA…', () => {
    expect(groupName(0)).toBe('Section A')
    expect(groupName(25)).toBe('Section Z')
    expect(groupName(26)).toBe('Section AA')
  })
})
