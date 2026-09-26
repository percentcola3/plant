import { describe, expect, it } from 'vitest'
import { PEEKA_PRESETS, peekaEndpoint, validatePeekaConnection } from './peeka'

describe('Peeka connection', () => {
  it('normalizes bases without doubling API paths', () => {
    expect(peekaEndpoint({ ...PEEKA_PRESETS.llm, baseUrl: `${PEEKA_PRESETS.llm.baseUrl}/v1` })).toBe(`${PEEKA_PRESETS.llm.baseUrl}/v1/messages`)
    expect(peekaEndpoint({ ...PEEKA_PRESETS.official, baseUrl: 'https://api.deepseek.com/chat/completions/' })).toBe('https://api.deepseek.com/chat/completions')
    expect(validatePeekaConnection({ ...PEEKA_PRESETS.official, model: ' custom ', baseUrl: 'https://api.deepseek.com/' }).model).toBe('custom')
  })
  it.each(['file:///tmp', 'https://user:key@example.com', 'https://example.com?key=x', 'bad-url'])('rejects invalid or credential-bearing URLs: %s', baseUrl => {
    expect(() => validatePeekaConnection({ ...PEEKA_PRESETS.official, baseUrl })).toThrow()
  })
})
