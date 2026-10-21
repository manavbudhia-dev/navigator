import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The only outside world the E2E run talks to: a job-application form, five
 * research articles, and an OpenAI-compatible chat endpoint that replays a
 * fixed script. Nothing leaves the machine and no real key is needed.
 */

const ROOT = process.cwd()
const PORT = Number(process.env['NAV_E2E_PORT'] ?? 8731)

const ARTICLES = new Set(['metering', 'coldclimate', 'fieldlab', 'utility', 'contractor'])

/** Keep in step with ARTICLE_DOMAIN in e2e/env.ts (this file is plain JS). */
const ARTICLE_DOMAIN = 'heatpump.test'

/** The fixture corpus, in the order a rotating results page hands them out. */
const RESULTS = [
  {
    slug: 'metering',
    title: 'Metering study: heat pumps cut heating bills by 40 percent',
    snippet: '214 homes metered. Heat pumps cut heating bills by 40 percent versus resistance heating.',
  },
  {
    slug: 'coldclimate',
    title: 'Cold climate field report: heat pump savings shrink below minus ten',
    snippet: 'In cold climates a heat pump cuts the heating bill by 21 percent, not 40.',
  },
  {
    slug: 'fieldlab',
    title: 'Live laboratory data: what a heat pump saves on a heating bill',
    snippet: 'Against electric resistance the heat pump cut the heating bill by 62 percent.',
  },
  {
    slug: 'utility',
    title: 'Utility programme evaluation: heat pump bill savings for 4,800 homes',
    snippet: 'The average home cut its heating bill by 31 percent after a heat pump retrofit.',
  },
  {
    slug: 'contractor',
    title: 'Retrofit contractor notes: the honest answer on heat pump savings',
    snippet: 'The machine saves money on the heating bill and a bad installation gives it back.',
  },
]

let resultsTurn = 0

/**
 * A results page with the whole fixture corpus on it, reordered each request so
 * a run of several searches does not keep offering the same two links first.
 * Every article lives on its own host: the engine keeps at most two pages per
 * domain, so a single-host corpus could never yield five sources.
 */
function resultsPage(query) {
  const start = resultsTurn % RESULTS.length
  resultsTurn += 1
  const hits = RESULTS.map((_, index) => RESULTS[(start + index) % RESULTS.length])
  const items = hits
    .map(
      (hit) => `
        <li class="result">
          <h2 class="result__title"><a href="http://${hit.slug}.${ARTICLE_DOMAIN}:${PORT}/sources/${hit.slug}">${hit.title}</a></h2>
          <div class="result__snippet">${hit.snippet} ${query}</div>
        </li>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${query} — Search</title></head>
    <body><h1>Results</h1><ol class="web-results">${items}</ol></body></html>`
}

/** A tool-calling turn in the shape OpenAI streams. */
function toolCallChunks(name, args) {
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: `call_${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ]
}

function textChunks(content) {
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]
}

/** Research prompts are answered with the JSON shape each parser expects. */
function researchReply(system) {
  if (system.includes('Shape: [{"question"')) {
    return textChunks(
      JSON.stringify([
        { question: 'Do heat pumps cut heating bills in cold climates?', queries: ['heat pump heating bill savings cold climate', 'do heat pumps save money heating bill'] },
        { question: 'What do metered studies report about heating bill savings?', queries: ['heat pump metered study heating bill saving'] },
        { question: 'When does a heat pump fail to save money?', queries: ['heat pump no bill saving cold climate'] },
        { question: 'How big is the saving compared with other heating systems?', queries: ['heat pump vs resistance heating bill saving', 'heat pump retrofit heating cost evaluation'] },
      ]),
    )
  }
  if (system.includes('"relevance":0..1')) {
    return textChunks(
      JSON.stringify({
        relevance: 0.9,
        credibility: 0.8,
        quotes: [],
        claims: ['A heat pump cuts the heating bill in cold climates, by a smaller share than in mild ones.'],
      }),
    )
  }
  if (system.includes('Shape: {"summary"')) {
    return textChunks(JSON.stringify({ summary: 'The source reports a real heating bill saving that shrinks in cold climates.' }))
  }
  if (system.includes('Shape: {"clusters"')) {
    return textChunks(JSON.stringify({ clusters: [] }))
  }
  return textChunks('Metered homes cut their heating bills by 31 to 40 percent [1], and the saving is smaller in cold climates [2].')
}

function agentReply(turn) {
  if (turn === 0) return toolCallChunks('read_page', {})
  if (turn === 1) return toolCallChunks('fill_form', { use_llm: false })
  return toolCallChunks('finish', {
    summary: 'Filled the application from the profile vault and left the blocked fields alone.',
    success: true,
  })
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}

async function handleCompletion(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  const body = await new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 4_000_000) reject(new Error('request too large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
    req.on('error', reject)
  })

  if (body === null) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"error":"bad json"}')
    return
  }

  const messages = body.messages ?? []
  const last = messages.at(-1)
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n')
  const chunks = Array.isArray(body.tools) && body.tools.length > 0
    ? agentReply(messages.filter((message) => message.role === 'assistant').length)
    : researchReply(system)

  res.writeHead(200, {
    ...CORS,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 60 } })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
  void last
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    void handleCompletion(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(`{"error":${JSON.stringify(String(error))}}`)
    })
    return
  }

  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }

  if (url.pathname === '/serp') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(resultsPage(url.searchParams.get('q') ?? ''))
    return
  }

  const slug = url.pathname.startsWith('/sources/') ? url.pathname.slice('/sources/'.length) : ''
  const file =
    url.pathname === '/form.html'
      ? path.join(ROOT, 'fixtures', 'form.html')
      : ARTICLES.has(slug)
        ? path.join(ROOT, 'e2e', 'fixtures', 'articles', `${slug}.html`)
        : null

  if (file === null) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }

  readFile(file)
    .then((html) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
    })
    .catch(() => {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('fixture missing')
    })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`navigator e2e mock on http://127.0.0.1:${PORT}`)
})
