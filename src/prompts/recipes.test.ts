import { describe, expect, it } from 'vitest'

import { healGoal } from './recipes'
import type { RecipeStep } from '@/recipes/types'

const CLICK: RecipeStep = {
  tool: 'click',
  args: {},
  note: 'Clicked Apply now.',
  target: {
    selector: {
      css: '#apply',
      xpath: '/html/body/button',
      textAnchor: 'Apply now',
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      tag: 'button',
      role: 'button',
      frameUrl: null,
    },
    label: 'Apply now',
    role: 'button',
    inputType: null,
  },
}

describe('healGoal', () => {
  it('names the step, its control and this run’s values', () => {
    const goal = healGoal('Apply to jobs', 3, CLICK, { job_title: 'React dev' }, 'the control was not found')
    expect(goal).toContain('"Apply to jobs"')
    expect(goal).toContain('step 3')
    expect(goal).toContain('"Apply now"')
    expect(goal).toContain('Clicked Apply now.')
    expect(goal).toContain('job_title = React dev')
    expect(goal).toContain('the control was not found')
  })

  it('keeps the model inside the one step', () => {
    const goal = healGoal('X', 1, { tool: 'wait', args: { seconds: 2 }, note: '', target: null }, {}, 'too fast')
    expect(goal).toContain('Do exactly this one thing and nothing else')
    expect(goal).toContain('Do not start any other task')
    expect(goal).toContain('wait on nothing in particular')
  })
})
