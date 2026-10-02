import { describe, expect, it } from 'vitest'
import { PLANT_PRESETS, plantEndpoint, validatePlantConnection } from './plant'

describe('Plant connection', () => {
  it('normalizes bases without doubling API paths', () => {
    expect(plantEndpoint({ ...PLANT_PRESETS.llm, baseUrl: `${PLANT_PRESETS.llm.baseUrl}/v1` })).toBe(`${PLANT_PRESETS.llm.baseUrl}/v1/messages`)
    expect(plantEndpoint({ ...PLANT_PRESETS.official, baseUrl: 'https://api.deepseek.com/chat/completions/' })).toBe('https://api.deepseek.com/chat/completions')
    expect(validatePlantConnection({ ...PLANT_PRESETS.official, model: ' custom ', baseUrl: 'https://api.deepseek.com/' }).model).toBe('custom')
  })
  it.each(['file:///tmp', 'https://user:key@example.com', 'https://example.com?key=x', 'bad-url'])('rejects invalid or credential-bearing URLs: %s', baseUrl => {
    expect(() => validatePlantConnection({ ...PLANT_PRESETS.official, baseUrl })).toThrow()
  })
})
