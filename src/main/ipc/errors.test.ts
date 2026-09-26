import { describe, expect, it } from 'vitest'
import { serializeError, UIClientError } from './errors'

describe('serializeError', () => {
  it('serializes UIClientError preserving code/message/details', () => {
    const err = new UIClientError('VALIDATION', 'msg must be a string', { field: 'msg' })
    expect(serializeError(err)).toEqual({
      code: 'VALIDATION',
      message: 'msg must be a string',
      details: { field: 'msg' }
    })
  })

  it('serializes plain Error with UNKNOWN code and stack details', () => {
    const err = new Error('boom')
    const out = serializeError(err)
    expect(out.code).toBe('UNKNOWN')
    expect(out.message).toBe('boom')
    expect(out.details).toMatchObject({ stack: expect.stringContaining('boom') })
  })

  it('serializes non-Error throws as UNKNOWN with stringified message', () => {
    expect(serializeError('oops')).toEqual({ code: 'UNKNOWN', message: 'oops' })
    expect(serializeError(42)).toEqual({ code: 'UNKNOWN', message: '42' })
    expect(serializeError(null)).toEqual({ code: 'UNKNOWN', message: 'null' })
  })
})
