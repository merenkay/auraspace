import { describe, expect, it } from 'vitest'
import { backspaceAt, enteredDigits, fillDigits } from './otp'

describe('fillDigits', () => {
  it('types one digit and advances', () => {
    expect(fillDigits('', 0, '4')).toEqual({ code: '4', focus: 1 })
    expect(fillDigits('12', 2, '3')).toEqual({ code: '123', focus: 3 })
  })
  it('keeps focus on the last box', () => {
    expect(fillDigits('12345', 5, '6')).toEqual({ code: '123456', focus: 5 })
  })
  it('overwrites a filled box', () => {
    expect(fillDigits('123456', 2, '9')).toEqual({ code: '129456', focus: 3 })
  })
  it('pastes from the current box, ignoring non-digits', () => {
    expect(fillDigits('12', 2, 'a3-4 5')).toEqual({ code: '12345', focus: 5 })
    expect(fillDigits('1', 1, '9999999')).toEqual({ code: '999999', focus: 5 })
    expect(fillDigits('', 0, '12 34 56')).toEqual({ code: '123456', focus: 5 })
  })
  it('ignores a paste without digits', () => {
    expect(fillDigits('12', 2, 'abc')).toEqual({ code: '12', focus: 2 })
  })
  it('never leaves a gap', () => {
    expect(fillDigits('1', 4, '7')).toEqual({ code: '17', focus: 2 })
  })
})

describe('enteredDigits', () => {
  it('reads one keystroke in an empty box', () => expect(enteredDigits('5', undefined, 1)).toBe('5'))
  it('reads the new digit in a filled box from the caret', () => {
    expect(enteredDigits('37', '3', 2)).toBe('7')
    expect(enteredDigits('73', '3', 1)).toBe('7')
    expect(enteredDigits('33', '3', 1)).toBe('3')
  })
  it('passes autofill through whole', () => {
    expect(enteredDigits('482913', undefined, 6)).toBe('482913')
    expect(enteredDigits('1482913', '1', 7)).toBe('482913')
  })
  it('drops non-digits', () => expect(enteredDigits('x', undefined, 1)).toBe(''))
})

describe('backspaceAt', () => {
  it('clears a filled box and stays', () => {
    expect(backspaceAt('123', 2)).toEqual({ code: '12', focus: 2 })
    expect(backspaceAt('123456', 5)).toEqual({ code: '12345', focus: 5 })
  })
  it('steps back from an empty box and clears the previous one', () => {
    expect(backspaceAt('12', 2)).toEqual({ code: '1', focus: 1 })
  })
  it('does nothing in the first empty box', () => {
    expect(backspaceAt('', 0)).toEqual({ code: '', focus: 0 })
  })
})
