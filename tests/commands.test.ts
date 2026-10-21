import { describe, expect, it } from 'vitest'
import { matchScore, parseCommand } from '@/lib/qa/commands'
import { validateRoute } from '@/lib/qa/router'

describe('voice commands', () => {
  it.each([
    ['Press doorbell press', { type: 'press', target: 'doorbell press' }],
    ['Click the start live view button.', { type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' }],
    ['Start live view', { type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' }],
    ['Turn on spoken announcements', { type: 'press', target: 'turn on spoken announcements' }],
    ['Go to settings', { type: 'navigate', path: '/settings', page: 'Settings' }],
    ['Open the demo page', { type: 'navigate', path: '/demo', page: 'Demo' }],
    ['Timeline', { type: 'navigate', path: '/timeline', page: 'Timeline' }],
    ['Switch to Hindi', { type: 'language', lang: 'hi' }],
    ['Bangla', { type: 'language', lang: 'bn' }],
    ['Turn on visual mode', { type: 'mode', mode: 'visual' }],
    ['Voice mode', { type: 'mode', mode: 'voice' }],
    ['Help', { type: 'help' }],
    ['What can I say', { type: 'help' }],
    ['Replay', { type: 'replay' }],
    ['Why did it say that', { type: 'why' }],
    ['Close', { type: 'close' }],
    ['I want to see live video', { type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' }],
    ['Show me the camera', { type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' }],
    ['Stop the live video', { type: 'navigate', path: '/live', page: 'Live', then: 'Stop live view' }],
    ['डेमो खोलो', { type: 'navigate', path: '/demo', page: 'Demo' }],
  ])('%s', (said, expected) => {
    expect(parseCommand(said)).toEqual(expected)
  })

  it.each(['Is the car still there?', 'Who is it?', 'What are they holding', 'Read the label', 'Describe everything', 'Did they leave'])(
    'leaves the question "%s" to Ask the Door',
    (q) => {
      expect(parseCommand(q)).toBeNull()
    }
  )

  it('matches spoken targets to button names', () => {
    expect(matchScore('doorbell press', 'Doorbell press')).toBe(100)
    expect(matchScore('motion vehicle', 'Motion: vehicle')).toBe(100)
    expect(matchScore('start live', 'Start live view')).toBeGreaterThanOrEqual(40)
    expect(matchScore('thats wrong', 'That’s wrong')).toBe(100)
    expect(matchScore('doorbell', 'Settings')).toBe(0)
  })

  it('accepts a model route only if it names a real control, page, language or mode', () => {
    const controls = ['Doorbell press', 'Motion: vehicle', 'Start live view']
    expect(validateRoute({ type: 'press', target: 'Doorbell press' }, controls)).toEqual({ type: 'press', target: 'Doorbell press' })
    expect(validateRoute({ type: 'press', target: 'doorbell' }, controls)).toEqual({ type: 'press', target: 'Doorbell press' })
    expect(validateRoute({ type: 'press', target: 'Delete the internet' }, controls)).toBeNull()
    expect(validateRoute({ type: 'navigate', target: 'Settings' }, controls)).toEqual({ type: 'navigate', path: '/settings', page: 'Settings' })
    expect(validateRoute({ type: 'navigate', target: 'admin' }, controls)).toBeNull()
    expect(validateRoute({ type: 'language', target: 'fr' }, controls)).toBeNull()
    expect(validateRoute({ type: 'question' }, controls)).toBeNull()
    expect(validateRoute('not json', controls)).toBeNull()
    expect(validateRoute({ type: 'navigate', target: 'live', then: 'Start live view' }, controls)).toEqual({ type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' })
    expect(validateRoute({ type: 'navigate', target: 'live', then: 'Format the disk' }, controls)).toEqual({ type: 'navigate', path: '/live', page: 'Live' })
  })
})
