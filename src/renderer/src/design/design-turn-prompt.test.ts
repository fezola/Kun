import { describe, expect, it } from 'vitest'
import { buildDesignTurnPrompt } from './design-turn-prompt'
import type { ScreenTurnOptions } from './design-turn-prompt'

describe('design turn prompt', () => {
  it('allows only the reserved HTML and companion design notes files for HTML turns', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Create a polished hero page',
      artifactRelativePath: '.kun-design/screen/v1.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain(
      'Modify ONLY `.kun-design/screen/v1.html` and `.kun-design/screen/DESIGN.md`'
    )
    expect(prompt).toContain('it has already been pre-created')
    expect(prompt).toContain('responsive to arbitrary canvas frame sizes')
  })

  it('passes selected screen frame details and notes file for screen turns', () => {
    const options: ScreenTurnOptions = {
      target: 'screen',
      mode: 'text',
      text: 'Make this a login page',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      screenName: 'Login',
      screenWidth: 420,
      screenHeight: 340,
      screenManifest: [
        {
          name: 'Home',
          width: 1280,
          height: 720,
          htmlPath: '.kun-design/home/v1.html'
        }
      ]
    }
    const prompt = buildDesignTurnPrompt(options)

    expect(prompt).toContain('Selected screen frame: 420x340 canvas pixels.')
    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain('Modify ONLY `.kun-design/screen/v2.html` and `.kun-design/screen/DESIGN.md`')
    expect(prompt).toContain('responsive to arbitrary selected frame sizes')
    expect(prompt).toContain('"Home" (1280x720)')
    expect(prompt).toContain('.kun-design/home/v1.html')
  })

  it('includes sibling pages so HTML turns stay cohesive across the canvas', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Design a settings page',
      artifactRelativePath: '.kun-design/settings/v1.html',
      workspaceRoot: '/workspace',
      screenManifest: [
        { name: 'Home', htmlPath: '.kun-design/home/v1.html', summary: 'Landing page' },
        { name: 'Chat', width: 420, height: 720, htmlPath: '.kun-design/chat/v1.html' }
      ]
    })

    expect(prompt).toContain('Other pages already in this project')
    expect(prompt).toContain('"Home" → .kun-design/home/v1.html — Landing page')
    expect(prompt).toContain('"Chat" (420x720) → .kun-design/chat/v1.html')
    expect(prompt).toContain('Do NOT modify sibling files')
  })

  it('includes selected HTML element context for focused edits', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Change this to a warmer headline',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      htmlElementContext: {
        artifactId: 'screen',
        artifactTitle: 'Welcome page',
        artifactRelativePath: '.kun-design/screen/v1.html',
        selector: 'body > main:nth-of-type(1) > h1:nth-of-type(1)',
        tagName: 'H1',
        text: 'Hello World',
        html: '<h1 class="hero-title">Hello World</h1>'
      }
    })

    expect(prompt).toContain('Selected HTML element context:')
    expect(prompt).toContain('CSS selector: body > main:nth-of-type(1) > h1:nth-of-type(1)')
    expect(prompt).toContain('Tag: <h1>')
    expect(prompt).toContain('Current text: Hello World')
    expect(prompt).toContain('Treat this selected element as the binding target')
  })

  it('tells the agent the path + directory of selected design artifacts (no inlined content)', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Match this page to the canvas',
      artifactRelativePath: '.kun-design/board/settings/v1.html',
      workspaceRoot: '/workspace',
      contextLocations: [
        {
          title: 'Settings',
          kind: 'html',
          path: '.kun-design/board/settings/v1.html',
          directory: '.kun-design/board/settings'
        },
        {
          title: 'Hero',
          kind: 'image',
          path: '.deepseekgui-images/hero.png',
          directory: '.deepseekgui-images'
        }
      ]
    })

    expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
    expect(prompt).toContain('do not inline them wholesale')
    expect(prompt).toContain('Settings [html] → `.kun-design/board/settings/v1.html` (directory: `.kun-design/board/settings`)')
    expect(prompt).toContain('Hero [image] → `.deepseekgui-images/hero.png` (directory: `.deepseekgui-images`)')
  })

  it('tells the agent the canvas.json directory on a canvas turn', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Tidy up the selected layers',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      contextLocations: [
        {
          title: 'Design canvas',
          kind: 'canvas',
          path: '.kun-design/board/canvas.json',
          directory: '.kun-design/board'
        }
      ]
    })

    expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
    expect(prompt).toContain('Design canvas [canvas] → `.kun-design/board/canvas.json` (directory: `.kun-design/board`)')
  })
})
