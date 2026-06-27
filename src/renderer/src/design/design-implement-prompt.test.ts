import { describe, expect, it } from 'vitest'
import { buildImplementDesignPrompt } from './design-implement-prompt'

describe('buildImplementDesignPrompt', () => {
  const base = {
    artifactTitle: 'Landing page',
    artifactRelativePath: '.kun-design/doc/abc/v1.html',
    workspaceRoot: '/ws'
  }

  it('instructs the agent to build/typecheck and visually compare against the design', () => {
    const prompt = buildImplementDesignPrompt(base)
    expect(prompt).toContain('build/typecheck')
    expect(prompt).toContain('compare it back against the design')
  })

  it('references the design notes path only when provided', () => {
    const withNotes = buildImplementDesignPrompt({
      ...base,
      designNotesRelativePath: '.kun-design/doc/abc/DESIGN.md'
    })
    expect(withNotes).toContain('.kun-design/doc/abc/DESIGN.md')
    expect(withNotes).toContain('design notes')

    const without = buildImplementDesignPrompt(base)
    expect(without).not.toContain('design notes')
  })

  it('uses the stack hint when given, otherwise asks the agent to detect the stack', () => {
    expect(buildImplementDesignPrompt({ ...base, stackHint: 'React + Tailwind' })).toContain(
      'Target stack: React + Tailwind'
    )
    expect(buildImplementDesignPrompt(base)).toContain("Detect this project's stack")
  })
})
