import { describe, expect, it } from 'vitest'
import {
  DESIGN_PAGES_MAX,
  buildDesignPlanPrompt,
  buildHtmlSiblingManifest,
  buildPrototypeLinksForPage,
  extractAgentDesignSummary,
  parsePagesPlan
} from './design-pages'
import { deriveParallelDesignPageStatesFromBlocks } from './design-pages-run'
import type { DesignArtifact } from './design-types'
import type { ChatBlock } from '../agent/types'

describe('extractAgentDesignSummary', () => {
  it('returns the closing prose paragraph, dropping code fences', () => {
    const reply = [
      'Here is the dashboard.',
      '',
      '```html',
      '<div>...</div>',
      '```',
      '',
      'A dark analytics dashboard with a teal accent, KPI cards and a sortable table.'
    ].join('\n')
    expect(extractAgentDesignSummary(reply)).toBe(
      'A dark analytics dashboard with a teal accent, KPI cards and a sortable table.'
    )
  })

  it('returns empty for blank or code-only replies', () => {
    expect(extractAgentDesignSummary('')).toBe('')
    expect(extractAgentDesignSummary('   ')).toBe('')
    expect(extractAgentDesignSummary('```html\n<div/>\n```')).toBe('')
  })

  it('caps an over-long summary', () => {
    const long = 'x'.repeat(400)
    const out = extractAgentDesignSummary(long)
    expect(out.length).toBeLessThanOrEqual(280)
    expect(out.endsWith('…')).toBe(true)
  })
})

function htmlArtifact(over: Partial<DesignArtifact> & { id: string }): DesignArtifact {
  return {
    kind: 'html',
    title: over.title ?? over.id,
    relativePath: over.relativePath ?? `.kun-design/${over.id}/v1.html`,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    versions: over.versions ?? [
      { id: `${over.id}-v1`, relativePath: `.kun-design/${over.id}/v1.html`, createdAt: '2026-06-22T00:00:00.000Z', summary: '' }
    ],
    ...over
  }
}

describe('buildHtmlSiblingManifest', () => {
  it('excludes the active artifact and surfaces summary + node dims', () => {
    const artifacts = [
      htmlArtifact({
        id: 'a',
        title: 'Home',
        node: { x: 0, y: 0, width: 420, height: 340 },
        versions: [{ id: 'a-v1', relativePath: '.kun-design/a/v1.html', createdAt: 'x', summary: 'Landing page' }]
      }),
      htmlArtifact({ id: 'b', title: 'Settings' })
    ]
    const manifest = buildHtmlSiblingManifest(artifacts, 'b')
    expect(manifest).toHaveLength(1)
    expect(manifest[0]).toMatchObject({
      name: 'Home',
      htmlPath: '.kun-design/a/v1.html',
      width: 420,
      height: 340,
      summary: 'Landing page'
    })
  })

  it('skips non-html artifacts and respects the limit', () => {
    const artifacts = [
      htmlArtifact({ id: 'a' }),
      { ...htmlArtifact({ id: 'c' }), kind: 'canvas' } as DesignArtifact,
      htmlArtifact({ id: 'd' }),
      htmlArtifact({ id: 'e' })
    ]
    expect(buildHtmlSiblingManifest(artifacts, null, 2)).toHaveLength(2)
    expect(buildHtmlSiblingManifest(artifacts, null).every((s) => s.name !== 'c')).toBe(true)
  })
})

describe('parsePagesPlan', () => {
  it('parses a ```pages fenced block', () => {
    const text = [
      'Here is the plan.',
      '```pages',
      '[',
      '  { "title": "Home", "brief": "Landing" },',
      '  { "title": "Chat", "brief": "Conversation" }',
      ']',
      '```'
    ].join('\n')
    expect(parsePagesPlan(text)).toEqual([
      { title: 'Home', brief: 'Landing' },
      { title: 'Chat', brief: 'Conversation' }
    ])
  })

  it('falls back to a ```json block and a bare array', () => {
    expect(parsePagesPlan('```json\n[{"title":"A","brief":"a"}]\n```')).toEqual([{ title: 'A', brief: 'a' }])
    expect(parsePagesPlan('noise [{"title":"B","brief":"b"}] tail')).toEqual([{ title: 'B', brief: 'b' }])
  })

  it('preserves prototype-flow metadata when the planner provides it', () => {
    const text = [
      '```pages',
      '[',
      '  { "title": "Home", "brief": "Landing", "userGoal": "Compare plans before signing up", "dataExamples": ["Pro plan $24", "Acme Finance", "14-day trial"], "states": ["loading prices", "empty comparison"], "primaryAction": "Start trial", "linksTo": ["Signup", "Dashboard", "", 42] },',
      '  { "title": "Signup", "brief": "Create account", "primaryAction": "Create account" }',
      ']',
      '```'
    ].join('\n')

    expect(parsePagesPlan(text)).toEqual([
      {
        title: 'Home',
        brief: 'Landing',
        userGoal: 'Compare plans before signing up',
        dataExamples: ['Pro plan $24', 'Acme Finance', '14-day trial'],
        states: ['loading prices', 'empty comparison'],
        primaryAction: 'Start trial',
        linksTo: ['Signup', 'Dashboard']
      },
      {
        title: 'Signup',
        brief: 'Create account',
        primaryAction: 'Create account'
      }
    ])
  })

  it('accepts semicolon-delimited data/state fallbacks from loose planners', () => {
    const text = [
      '```pages',
      '[',
      '  { "title": "Ops", "brief": "Operations dashboard", "data": "APAC queue; 18 overdue tasks", "keyStates": "offline mode; empty queue" }',
      ']',
      '```'
    ].join('\n')

    expect(parsePagesPlan(text)).toEqual([
      {
        title: 'Ops',
        brief: 'Operations dashboard',
        dataExamples: ['APAC queue', '18 overdue tasks'],
        states: ['offline mode', 'empty queue']
      }
    ])
  })

  it('dedupes by title, caps at max, and uses title when brief is missing', () => {
    const items = Array.from({ length: 9 }, (_, i) => `{ "title": "P${i}", "brief": "b${i}" }`)
    items.push('{ "title": "P0", "brief": "dupe" }') // duplicate title dropped
    items.push('{ "title": "NoBrief" }') // brief falls back to title
    const text = '```pages\n[' + items.join(',') + ']\n```'
    const pages = parsePagesPlan(text)
    expect(pages.length).toBe(DESIGN_PAGES_MAX)
    expect(pages[0]).toEqual({ title: 'P0', brief: 'b0' })
  })

  it('returns [] when nothing parses', () => {
    expect(parsePagesPlan('no json here')).toEqual([])
    expect(parsePagesPlan('```pages\nnot json\n```')).toEqual([])
    expect(parsePagesPlan('')).toEqual([])
  })
})

describe('buildPrototypeLinksForPage', () => {
  it('resolves planner links to target artifacts and local hrefs', () => {
    const links = buildPrototypeLinksForPage(
      {
        title: 'Home',
        brief: 'Landing',
        primaryAction: 'Start trial',
        linksTo: ['Signup', 'Dashboard', 'Signup']
      },
      '.kun-design/doc/home/v1.html',
      [
        { title: 'Home', artifactId: 'home', relativePath: '.kun-design/doc/home/v1.html' },
        { title: 'Signup', artifactId: 'signup', relativePath: '.kun-design/doc/signup/v1.html' }
      ]
    )

    expect(links).toEqual([
      {
        targetTitle: 'Signup',
        targetArtifactId: 'signup',
        href: '../signup/v1.html',
        label: 'Start trial'
      },
      {
        targetTitle: 'Dashboard'
      }
    ])
  })
})

describe('buildDesignPlanPrompt', () => {
  it('embeds the brief, bounds the page count, and lists existing pages', () => {
    const prompt = buildDesignPlanPrompt({
      brief: 'A habit tracker app',
      workspaceRoot: '/ws',
      maxPages: 99,
      existingPages: [{ name: 'Login', htmlPath: '.kun-design/x/v1.html', summary: 'auth' }]
    })
    expect(prompt).toContain('A habit tracker app')
    expect(prompt).toContain(`2-${DESIGN_PAGES_MAX} pages`)
    expect(prompt).toContain('"Login"')
    expect(prompt).toContain('do NOT duplicate')
    expect(prompt).toContain('primary action')
    expect(prompt).toContain('userGoal')
    expect(prompt).toContain('dataExamples')
    expect(prompt).toContain('states')
    expect(prompt).toContain('linksTo')
    expect(prompt).toContain('clickable prototype flow')
    expect(prompt).toContain('realistic domain nouns')
    expect(prompt).toContain('mobile/desktop behavior')
    expect(prompt).toContain('Design delivery checklist')
  })
})

describe('deriveParallelDesignPageStatesFromBlocks', () => {
  it('keeps the tool-to-artifact mapping from running args through completed results', () => {
    const jobs = [
      {
        artifactId: 'landing',
        title: 'Landing',
        relativePath: '.kun-design/doc/landing/v1.html',
        designMdPath: '.kun-design/doc/landing/DESIGN.md',
        brief: 'Landing page',
        screenManifest: []
      }
    ]
    const toolIds = new Map<string, string>()
    const running: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_call_a',
        summary: 'delegate_task',
        status: 'running',
        detail: JSON.stringify({ label: 'page:landing', prompt: 'write .kun-design/doc/landing/v1.html' }),
        meta: { toolName: 'delegate_task' }
      }
    ]

    const runningStates = deriveParallelDesignPageStatesFromBlocks(running, jobs, {}, toolIds)
    expect(runningStates).toEqual([{ artifactId: 'landing', status: 'running', updatedAt: expect.any(String) }])

    const completed: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'tool_call_a',
        summary: 'delegate_task',
        status: 'success',
        detail: JSON.stringify({
          childId: 'child_1',
          status: 'completed',
          summary: 'A finished landing page.'
        }),
        meta: { toolName: 'delegate_task' }
      }
    ]
    const doneStates = deriveParallelDesignPageStatesFromBlocks(
      completed,
      jobs,
      Object.fromEntries(runningStates.map((state) => [state.artifactId, state])),
      toolIds
    )
    expect(doneStates[0]).toMatchObject({
      artifactId: 'landing',
      childId: 'child_1',
      status: 'done',
      summary: 'A finished landing page.'
    })
  })

  it('marks failed delegate_task results on the matching page', () => {
    const jobs = [
      {
        artifactId: 'community',
        title: 'Community',
        relativePath: '.kun-design/doc/community/v1.html',
        designMdPath: '.kun-design/doc/community/DESIGN.md',
        brief: 'Community page',
        screenManifest: []
      }
    ]
    const states = deriveParallelDesignPageStatesFromBlocks(
      [
        {
          kind: 'tool',
          id: 'tool_call_b',
          summary: 'delegate_task',
          status: 'error',
          detail: JSON.stringify({
            label: 'page:community',
            status: 'failed',
            error: 'model request failed'
          }),
          meta: { toolName: 'delegate_task' }
        }
      ],
      jobs
    )
    expect(states[0]).toMatchObject({
      artifactId: 'community',
      status: 'failed',
      error: 'model request failed'
    })
  })
})
