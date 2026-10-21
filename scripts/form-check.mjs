import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const OPTIONS = { includeOffViewport: true, maxElements: 400, tokenBudget: 4000 }

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 1400 })
await page.goto('http://localhost:5173/fixtures/form.html', { waitUntil: 'networkidle0' })

// Vite appends ?t= to rewritten imports; reuse the exact specifier overlay.ts already
// holds so pageState.ts is not instantiated twice (its snapshot is module-global).
const overlaySrc = await (await fetch('http://localhost:5173/src/content/overlay.ts')).text()
const pageStateUrl = overlaySrc.match(/from "([^"]*perception\/pageState\.ts[^"]*)"/)?.[1]
if (!pageStateUrl) throw new Error('Could not find pageState import in transformed overlay.ts')

const report = await page.evaluate(
  async (psUrl, options) => {
    const { buildPageState, getSnapshot } = await import(psUrl)
    const { readFormFields } = await import('/src/content/formFields.ts')
    const { planFill, applyMapping } = await import('/src/forms/mapper.ts')
    const { buildFormMappingMessages, parseFormMapping, allowedValuesFor } = await import(
      '/src/prompts/formMapper.ts'
    )
    const { performAct } = await import('/src/content/actions.ts')
    const { setOverlay, markForReview } = await import('/src/content/overlay.ts')

    const profile = {
      id: 'p1',
      name: 'Personal',
      kind: 'personal',
      updatedAt: Date.now(),
      identity: { firstName: 'Manav', lastName: 'Shah', dob: '1994-03-11' },
      contact: { email: 'manav@example.com', phone: '+91 98200 00000', altPhone: '+91 90000 11111' },
      links: {},
      addresses: [
        {
          label: 'home',
          line1: '12 Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400020',
          country: 'India',
        },
      ],
      work: [],
      education: [],
      skills: ['TypeScript', 'React', 'Tailwind'],
      documents: [
        { fileName: 'cover.txt', kind: 'cover-letter', text: 'Dear hiring manager, I build tools.' },
      ],
      answers: {},
    }

    buildPageState(document, options)

    // Vite rewrites inline <script> tags in served HTML, so count submissions
    // from here instead of trusting the fixture's own listener.
    let submissions = 0
    document.getElementById('apply').addEventListener('submit', (event) => {
      event.preventDefault()
      submissions += 1
    })

    const fields = readFormFields(document, getSnapshot())
    const plan = planFill(fields, profile)

    const prompt =
      plan.ambiguous.length > 0 ? buildFormMappingMessages(plan.ambiguous, '')[1].content : ''
    // Stand-in for the small model: it may only pick from the listed values.
    const pretendReply = plan.ambiguous
      .map((f, i) => {
        const chosen = i === 0 ? f.candidates[0] : f.candidates[f.candidates.length - 1]
        return `"${f.index}": ${JSON.stringify(chosen.value)}`
      })
      .join(',')
    const mapping = parseFormMapping(
      prompt === '' ? '{}' : `{${pretendReply}}`,
      allowedValuesFor(plan.ambiguous),
    )
    const finalPlan = applyMapping(plan, mapping)

    const typed = []
    for (const fill of finalPlan.fills) {
      const outcome = performAct({ type: 'type', index: fill.index, text: fill.value })
      typed.push({ index: fill.index, label: fill.label, key: fill.profileKey, value: fill.value, ok: outcome.ok })
    }
    setOverlay(true)
    markForReview(plan.blocked.map((field) => field.index))

    const valueById = {}
    for (const id of [
      'first',
      'last',
      'mail',
      'home-phone',
      'work-phone',
      'birth',
      'country',
      'skills',
      'letter',
      'mystery',
      'card',
      'pw',
      'otp',
      'cv',
      'robot',
      'terms',
    ]) {
      const el = document.getElementById(id)
      valueById[id] = el instanceof HTMLInputElement ? (el.type === 'checkbox' ? el.checked : el.value) : el?.value ?? null
    }

    return {
      fieldCount: fields.length,
      fills: typed,
      blocked: plan.blocked.map((b) => `${b.index}/${b.kind}`),
      ambiguousBefore: plan.ambiguous.map((a) => `${a.index}/${a.kind}:${a.candidates.length}`),
      ambiguousAfter: finalPlan.ambiguous.map((a) => a.index),
      skipped: plan.skipped.map((s) => `${s.index}/${s.reason}`),
      promptHead: prompt.split('\n').slice(0, 3).join(' | '),
      reviewBoxes: document.querySelectorAll('#navigator-overlay .nav-review').length,
      submissions,
      valueById,
    }
  },
  pageStateUrl,
  OPTIONS,
)

await page.screenshot({ path: 'C:/Users/manav/AppData/Local/Temp/navigator-form.png' })
console.log(JSON.stringify(report, null, 2))

const v = report.valueById
const checks = {
  fieldsRead: report.fieldCount >= 15,
  namesFilled: v.first === 'Manav' && v.last === 'Shah',
  emailFilled: v.mail === 'manav@example.com',
  dateNormalized: v.birth === '3/11/1994',
  dropdownMatched: v.country === 'India',
  coverLetterFilled: typeof v.letter === 'string' && v.letter.startsWith('Dear hiring manager'),
  skillsTruncated: (v.skills ?? '').length <= 20 && (v.skills ?? '').length > 0,
  llmResolvedPhones: v['home-phone'] === '+91 98200 00000' && v['work-phone'] === '+91 90000 11111',
  cardUntouched: v.card === '',
  passwordUntouched: v.pw === '',
  otpUntouched: v.otp === '',
  fileUntouched: v.cv === '',
  captchaUntouched: v.robot === false,
  consentUntouched: v.terms === false,
  mysteryUntouched: v.mystery === '',
  blockedHighlighted: report.reviewBoxes === report.blocked.length,
  nothingSubmitted: report.submissions === 0,
  noAmbiguityLeft: report.ambiguousAfter.length === 0,
}

await browser.close()
const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(JSON.stringify(checks, null, 2))
console.log(failed.length === 0 ? 'FORM CHECK: PASS' : `FORM CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
