import { describe, expect, it } from 'vitest'
import { duration, pct, plural } from './format'

describe('format helpers', () => {
  it('formats durations', () => {
    expect(duration(null)).toBe('—')
    expect(duration(45)).toBe('45 min')
    expect(duration(60)).toBe('1 h')
    expect(duration(130)).toBe('2 h 10 m')
    expect(duration(60 * 26)).toBe('1 d 2 h')
  })
  it('computes safe percentages', () => {
    expect(pct(1, 4)).toBe(25)
    expect(pct(3, 0)).toBe(0)
  })
  it('pluralises', () => {
    expect(plural(1, 'bed')).toBe('1 bed')
    expect(plural(2, 'bed')).toBe('2 beds')
  })
})
