import { describe, expect, it } from 'vitest'
import { CHUNK_ERROR } from './recover'

describe('stale-build recovery', () => {
  it('recognises the messages browsers use for a failed module import', () => {
    expect(CHUNK_ERROR.test('Failed to fetch dynamically imported module: https://auraspace.space/assets/Coach-abc.js')).toBe(true) // Chrome, Edge
    expect(CHUNK_ERROR.test('error loading dynamically imported module')).toBe(true) // Firefox
    expect(CHUNK_ERROR.test('Importing a module script failed.')).toBe(true) // Safari
    expect(CHUNK_ERROR.test('Unable to preload CSS for /assets/Aura-abc.css')).toBe(true) // Vite preload
  })

  it('never treats an ordinary network failure as a reason to reload', () => {
    expect(CHUNK_ERROR.test('Failed to fetch')).toBe(false) // an API call or a blocked third-party request
    expect(CHUNK_ERROR.test('NetworkError when attempting to fetch resource.')).toBe(false)
    expect(CHUNK_ERROR.test('Not allowed')).toBe(false)
  })
})
