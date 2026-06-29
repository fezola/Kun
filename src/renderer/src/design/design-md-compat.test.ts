import { describe, expect, it } from 'vitest'
import {
  STITCH_DESIGN_MD_PATH,
  buildStitchDesignMarkdown,
  importStitchDesignMarkdown,
  parseStitchDesignMarkdown
} from './design-md-compat'
import type { DesignArtifact } from './design-types'
import type { DesignSystem } from './canvas/design-system-types'
import type { CanvasShape } from './canvas/canvas-types'

const now = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title,
    relativePath,
    designMdPath: `.kun-design/doc/${id}/DESIGN.md`,
    createdAt: now,
    updatedAt: now,
    versions: [{ id: `${id}-v1`, relativePath, createdAt: now, summary: '' }],
    ...extra
  }
}

function shape(id: string): CanvasShape {
  return {
    id,
    type: 'frame',
    name: id,
    parentId: null,
    frameId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    cornerRadius: 0,
    children: []
  }
}

describe('design-md-compat', () => {
  it('uses a project-level DESIGN.md path under .kun-design', () => {
    expect(STITCH_DESIGN_MD_PATH).toBe('.kun-design/DESIGN.md')
  })

  it('exports context, tokens, components, screens, and prototype flow', () => {
    const system: DesignSystem = {
      tokens: {
        'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' },
        'space/md': { name: 'space/md', kind: 'space', value: 16 }
      },
      components: {
        card: {
          id: 'card',
          name: 'Insight card',
          version: 1,
          tree: [shape('card-root')],
          slots: [{ path: 'Title', kind: 'text' }]
        }
      }
    }
    const markdown = buildStitchDesignMarkdown({
      title: 'Ops app',
      brief: 'An operations workspace',
      designContext: {
        brandColor: '#2563eb',
        designSystemPreset: 'shadcn',
        tone: ['专业']
      },
      designSystem: system,
      designSystemMdPath: '.kun-design/DESIGN_SYSTEM.md',
      projectBriefPath: '.kun-design/doc/design.md',
      artifacts: [
        artifact('home', 'Home', {
          direction: { id: 'dir_1', name: 'Ops direction', status: 'active' },
          prototypeLinks: [
            {
              targetTitle: 'Details',
              targetArtifactId: 'details',
              href: '../details/v1.html',
              label: 'Open details'
            }
          ]
        }),
        artifact('details', 'Details')
      ],
      updatedAt: now
    })

    expect(markdown).toContain('# DESIGN.md: Ops app')
    expect(markdown).toContain('Project brief: `.kun-design/doc/design.md`')
    expect(markdown).toContain('Preset: shadcn/ui')
    expect(markdown).toContain('Brand color anchor: #2563eb')
    expect(markdown).toContain('| `brand/primary` | color | #2563eb |')
    expect(markdown).toContain('**Insight card**')
    expect(markdown).toContain('**Home**')
    expect(markdown).toContain('direction: Ops direction')
    expect(markdown).toContain('Open details -> Details (details) via `../details/v1.html`')
  })

  it('parses exported markdown into importable guideline sections', () => {
    const markdown = buildStitchDesignMarkdown({
      title: 'Ops app',
      brief: 'An operations workspace',
      artifacts: [artifact('home', 'Home')],
      updatedAt: now
    })
    const parsed = parseStitchDesignMarkdown(markdown)

    expect(parsed?.title).toBe('DESIGN.md: Ops app')
    expect(parsed?.sections['Product Brief']).toContain('An operations workspace')
    expect(parsed?.designGuidelines).toContain('**Home**')
    expect(parseStitchDesignMarkdown('   ')).toBeNull()
  })

  it('imports exported markdown into design context and simple tokens', () => {
    const markdown = buildStitchDesignMarkdown({
      title: 'Ops app',
      brief: 'An operations workspace',
      designContext: {
        brandColor: '#2563eb',
        designSystemPreset: 'shadcn'
      },
      designSystem: {
        tokens: {
          'brand/primary': { name: 'brand/primary', kind: 'color', value: '#2563eb' },
          'space/md': { name: 'space/md', kind: 'space', value: 16 },
          'radius/card': { name: 'radius/card', kind: 'radius', value: 12 },
          'type/body': {
            name: 'type/body',
            kind: 'type',
            value: { fontFamily: 'Inter', fontSize: 15, fontWeight: 500, lineHeight: 1.6 }
          }
        },
        components: {}
      },
      updatedAt: now
    })

    const imported = importStitchDesignMarkdown(markdown)

    expect(imported?.contextPatch.brandColor).toBe('#2563eb')
    expect(imported?.contextPatch.designSystemPreset).toBe('shadcn')
    expect(imported?.contextPatch.designGuidelines).toContain('Imported from DESIGN.md: Ops app')
    expect(imported?.tokens).toEqual([
      { name: 'brand/primary', kind: 'color', value: '#2563eb' },
      { name: 'radius/card', kind: 'radius', value: 12 },
      { name: 'space/md', kind: 'space', value: 16 },
      {
        name: 'type/body',
        kind: 'type',
        value: { fontFamily: 'Inter', fontSize: 15, fontWeight: 500, lineHeight: 1.6 }
      }
    ])
    expect(importStitchDesignMarkdown('')).toBeNull()
  })
})
