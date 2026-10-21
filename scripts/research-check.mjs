import { existsSync } from 'node:fs'

import puppeteer from 'puppeteer-core'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
]

const executablePath = CANDIDATES.find((candidate) => candidate !== '' && existsSync(candidate))
if (!executablePath) throw new Error('No Chromium browser found on this machine')

const BASE = 'http://localhost:5173'
const SERP = `${BASE}/fixtures/research-serp.html`

/** Fake URLs → fixture files, so the real gather path runs without the network. */
const PAGES = {
  'https://metering.example.edu/heat-pump-bill-savings': '/fixtures/research-metering.html',
  'https://heatpumpwatch.example.org/cold-climate-failures': '/fixtures/research-coldclimate.html',
  'https://blog.example.com/sourdough-bread-guide': '/fixtures/research-bread.html',
  'https://forum.example.net/thread/40-percent': '/fixtures/research-forum.html',
}

const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text())
})

await page.goto(`${BASE}/src/sidepanel/index.html`, { waitUntil: 'networkidle0' })

const report = await page.evaluate(
  async (serpUrl, pages) => {
    const { runResearch } = await import('/src/research/engine.ts')
    const { collectLinks, readArticle } = await import('/src/content/article.ts')
    const { rankHits } = await import('/src/research/search.ts')
    const { toCsv, toJson, toTable, toMarkdown, toBrief, render } = await import('/src/research/format.ts')
    const { layoutAnswer } = await import('/src/research/citations.ts')
    const { buildFollowupContext } = await import('/src/research/retrieve.ts')
    const { citationNumbers } = await import('/src/research/citations.ts')
    const { saveResearchResult, loadResearchResult, listResearchRuns } = await import(
      '/src/research/store.ts'
    )
    const { db } = await import('/src/memory/db.ts')

    await db.researchNotes.clear()
    await db.researchRuns.clear()

    const parse = async (path) => {
      const response = await fetch(path)
      if (!response.ok) return null
      return new DOMParser().parseFromString(await response.text(), 'text/html')
    }

    const stats = { reads: [], searches: 0, inFlight: 0, maxInFlight: 0 }

    const host = {
      async search(query, limit) {
        stats.searches += 1
        stats.inFlight += 1
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
        try {
          const doc = await parse('/fixtures/research-serp.html')
          if (doc === null) return []
          const links = collectLinks(doc)
          const ranked = rankHits(links, query, limit, { baseUrl: serpUrl })
          // The engine asks for 3x the pages it opens; the fixture page has 4 results.
          return ranked
        } finally {
          stats.inFlight -= 1
        }
      },
      async readPage(url) {
        stats.inFlight += 1
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
        stats.reads.push(url)
        try {
          const path = pages[url]
          if (path === undefined) return null
          const doc = await parse(path)
          if (doc === null) return null
          const article = readArticle(doc)
          // A real tab reports its own URL; a parsed document reports ours.
          return { url, title: article.title, text: article.text, author: article.author, publishDate: article.publishDate }
        } finally {
          stats.inFlight -= 1
        }
      },
    }

    const standardEvents = []
    const deepEvents = []
    const run = (id, depth, sink) =>
      runResearch({
        id,
        question: 'Do heat pumps actually cut heating bills in cold climates?',
        depth,
        host,
        onEvent: (event) => sink.push(event),
        signal: new AbortController().signal,
      })

    const standard = await run('check-standard', 'standard', standardEvents)
    const deep = await run('check-deep', 'deep', deepEvents)

    await saveResearchResult(standard)
    await saveResearchResult(deep)
    const reloaded = await loadResearchResult(standard.id)
    const stored = await listResearchRuns()

    const numbers = new Set(standard.citations.map((citation) => citation.n))
    const cited = [...standard.answer.matchAll(/\[(\d{1,3})\]/g)].map((match) => Number(match[1]))
    const numberById = new Map(citationNumbers(standard.sources).map((c) => [c.sourceId, c.n]))
    const followup = buildFollowupContext(standard.sources, numberById, 'what did the metering study find')
    const lines = layoutAnswer(standard.answer, standard.sources)

    return {
      stats: { ...stats, reads: stats.reads.slice() },
      counts: {
        subQuestions: standardEvents.find((event) => event.type === 'plan')?.subQuestions.length ?? 0,
        searches: standardEvents.filter((event) => event.type === 'search').length,
        opens: standardEvents.filter((event) => event.type === 'open').length,
        kept: standardEvents.filter((event) => event.type === 'note').length,
        dropped: standardEvents.filter((event) => event.type === 'scored' && !event.kept).length,
        synthesis: standardEvents.filter((event) => event.type === 'synthesis').length,
        deepSubQuestions: deepEvents.find((event) => event.type === 'plan')?.subQuestions.length ?? 0,
        deepSearches: deepEvents.filter((event) => event.type === 'search').length,
        deepRounds: deepEvents.filter((event) => event.type === 'round').length,
        deepGapEvents: deepEvents.filter((event) => event.type === 'gaps').length,
        deepGapsReported: deepEvents.find((event) => event.type === 'gaps')?.gaps.length ?? -1,
      },
      standard: {
        sources: standard.sources.map((note) => ({
          url: note.url,
          claims: note.claims.length,
          relevance: note.relevance,
          credibility: note.credibility,
          author: note.author,
          date: note.publishDate,
        })),
        discarded: standard.discarded,
        clusters: standard.clusters.map((cluster) => ({
          agreement: cluster.agreement,
          sources: cluster.sources.length,
          text: cluster.text.slice(0, 90),
        })),
        contradictions: standard.contradictions,
        gaps: standard.gaps,
        rounds: standard.rounds,
        citations: standard.citations,
        answer: standard.answer,
        brief: standard.brief,
      },
      deep: { rounds: deep.rounds, sources: deep.sources.length, gaps: deep.gaps.length },
      stored: { runs: stored.length, reloadedSources: reloaded?.sources.length ?? -1 },
      citedAllValid: cited.every((n) => numbers.has(n)),
      followupContext: followup.context.slice(0, 240),
      followupNotes: followup.used.length,
      layout: {
        lines: lines.length,
        sourcedSentences: lines.flatMap((line) => line.parts).filter((part) => part.sources.length > 0).length,
      },
      exports: {
        markdown: toMarkdown(standard),
        table: toTable(standard),
        csv: toCsv(standard),
        brief: toBrief(standard),
        json: toJson(standard, '{"summary":"answer","refs":"sources"}'),
        jsonDefault: render(standard, 'json'),
      },
    }
  },
  SERP,
  PAGES,
)

await browser.close()

const keptUrls = report.standard.sources.map((note) => note.url)
const checks = {
  plannedSubQuestions: report.counts.subQuestions >= 3,
  searchedSeveralQueries: report.counts.searches >= 4,
  eachFixtureReadOncePerRun:
    report.stats.reads.length === 8 && new Set(report.stats.reads).size === 4,
  poolStayedWithinBounds: report.stats.maxInFlight <= 4,
  keptTwoRelevantSources: report.standard.sources.length >= 2,
  offTopicPageDiscarded: report.standard.discarded.some(
    (entry) => entry.url === 'https://blog.example.com/sourdough-bread-guide' && entry.relevance < 0.4,
  ),
  forumKeptButLowCredibility: (() => {
    const forum = report.standard.sources.find(
      (note) => note.url === 'https://forum.example.net/thread/40-percent',
    )
    const study = report.standard.sources.find(
      (note) => note.url === 'https://metering.example.edu/heat-pump-bill-savings',
    )
    return forum !== undefined && study !== undefined && forum.credibility < study.credibility
  })(),
  bylineAndDateCaptured: report.standard.sources.some(
    (note) => note.author !== null && note.date !== null,
  ),
  everyKeptSourceHasClaims: report.standard.sources.every((note) => note.claims > 0),
  contradictionFlagged: report.standard.contradictions.length >= 1,
  contradictionShowsBothSides: report.standard.contradictions.every(
    (conflict) => conflict.sides.length >= 2,
  ),
  citationsAllResolve: report.citedAllValid,
  answerHasCitations: /\[\d+\]/.test(report.standard.answer),
  layoutGivesSentenceSources: report.layout.sourcedSentences >= 1,
  followupFindsSources: report.followupNotes >= 1 && report.followupContext !== '',
  deepPlannedMoreSubQuestions: report.counts.deepSubQuestions > report.counts.subQuestions,
  deepSearchedAtLeastAsMuch: report.counts.deepSearches >= report.counts.searches,
  deepRoundsMatchGaps:
    report.counts.deepGapEvents === 1 &&
    (report.counts.deepGapsReported > 0
      ? report.counts.deepRounds === 2 && report.deep.rounds === 2
      : report.counts.deepRounds === 1 && report.deep.rounds === 1),
  deepKeptSources: report.deep.sources >= 2,
  storedRoundTrip: report.stored.reloadedSources === report.standard.sources.length,
  bothRunsStored: report.stored.runs === 2,
  markdownHasSourceList: report.exports.markdown.includes('## Sources'),
  markdownShowsDisagreement: report.exports.markdown.includes('Where the sources disagree'),
  tableHasRowPerSource:
    report.exports.table.split('\n').length - 2 === report.standard.sources.length,
  csvHasHeaderAndClaims: report.exports.csv.split('\n').length > report.standard.sources.length,
  jsonHonoursSchema:
    report.exports.json.startsWith('{') &&
    JSON.parse(report.exports.json).summary === report.standard.answer &&
    !('answer' in JSON.parse(report.exports.json)),
  jsonDefaultHasTokens: 'tokens' in JSON.parse(report.exports.jsonDefault),
  briefIsBullets: report.exports.brief.startsWith('- '),
}

console.log(JSON.stringify(report.standard.sources, null, 2))
console.log(JSON.stringify(report.counts, null, 2))
console.log(JSON.stringify(report.standard.answer, null, 2))
console.log(JSON.stringify(checks, null, 2))

const failed = Object.entries(checks).filter(([, ok]) => ok !== true)
console.log(failed.length === 0 ? 'RESEARCH CHECK: PASS' : `RESEARCH CHECK: FAIL ${failed.map(([k]) => k).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
