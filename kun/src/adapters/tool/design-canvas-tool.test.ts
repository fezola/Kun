import { describe, expect, it } from 'vitest'
import {
  createDesignCanvasTool,
  createDesignCreateScreenTool,
  createDesignSvgCreateTool,
  createDesignSystemTemplateTool,
  createDesignUpdateShapesTool,
  createDesignValidateTool,
  DESIGN_CANVAS_TOOL_NAME,
  DESIGN_CREATE_SCREEN_TOOL_NAME,
  DESIGN_SVG_CREATE_TOOL_NAME,
  DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
  DESIGN_UPDATE_SHAPES_TOOL_NAME,
  DESIGN_VALIDATE_TOOL_NAME
} from './design-canvas-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'

function context(guiDesignCanvas = true): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...(guiDesignCanvas ? { guiDesignCanvas: true } : {})
  }
}

describe('design_canvas tool', () => {
  it('is advertised only for design canvas turns', () => {
    const tool = createDesignCanvasTool()
    expect(tool.name).toBe(DESIGN_CANVAS_TOOL_NAME)
    expect(tool.description).toContain('Code-mode sidebar whiteboard')
    expect(JSON.stringify(tool.inputSchema)).toContain('Code whiteboard creates an editable frame')
    expect(JSON.stringify(tool.inputSchema)).toContain('inspect the current canvas snapshot')
    expect(JSON.stringify(tool.inputSchema)).toContain('non-overlapping slot')
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
    expect(tool.shouldAdvertise?.(context(false))).toBe(false)
  })

  it('normalizes add_screen calls to renderer shape ops', async () => {
    const tool = createDesignCanvasTool()
    const result = await tool.execute(
      {
        action: 'add_screen',
        name: 'Home',
        brief: 'Mobile app home',
        devicePreset: 'mobile',
        width: 390,
        height: 844
      },
      context()
    )
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      action: 'add_screen',
      ops: [
        {
          op: 'add-screen',
          name: 'Home',
          brief: 'Mobile app home',
          devicePreset: 'mobile',
          width: 390,
          height: 844
        }
      ]
    })
  })

  it('returns update_shapes ops unchanged for the renderer to validate', async () => {
    const tool = createDesignCanvasTool()
    const op = { op: 'add', shape: { type: 'rect', width: 40, height: 40 } }
    const result = await tool.execute({ action: 'update_shapes', ops: [op] }, context())
    expect(result.output).toMatchObject({
      ok: true,
      action: 'update_shapes',
      ops: [op]
    })
  })

  it('rejects malformed update_shapes calls', async () => {
    const tool = createDesignCanvasTool()
    const result = await tool.execute({ action: 'update_shapes' }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      ok: false,
      error: 'update_shapes requires ops as an object or array'
    })
  })
})

describe('dedicated design tools', () => {
  it('creates a first-class SVG handoff only for product Design turns', async () => {
    const tool = createDesignSvgCreateTool()
    const designContext = { ...context(true), guiDesignMode: true }
    expect(tool.name).toBe(DESIGN_SVG_CREATE_TOOL_NAME)
    expect(tool.toolKind).toBe('file_change')
    expect(tool.shouldAdvertise?.(designContext)).toBe(true)
    expect(tool.shouldAdvertise?.(context(true))).toBe(false)
    expect(tool.shouldAdvertise?.({ ...designContext, guiDesignCanvas: undefined })).toBe(false)

    const result = await tool.execute({
      name: 'Orbit loader',
      brief: 'A compact looping vector loader',
      width: 240,
      height: 160
    }, designContext)
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_SVG_CREATE_TOOL_NAME,
      ops: [{
        op: 'add-svg-artifact',
        artifactId: expect.stringMatching(/^svg-[a-f0-9]{12}$/),
        name: 'Orbit loader',
        brief: 'A compact looping vector loader',
        width: 240,
        height: 160
      }]
    })

    const replay = await tool.execute({
      name: 'Orbit loader',
      brief: 'A compact looping vector loader',
      width: 240,
      height: 160
    }, designContext)
    expect((replay.output as { ops: Array<{ artifactId: string }> }).ops[0]?.artifactId)
      .toBe((result.output as { ops: Array<{ artifactId: string }> }).ops[0]?.artifactId)
  })

  it('does not advertise renderer-backed SVG creation in a read-only sandbox', async () => {
    const host = new LocalToolHost({ tools: [createDesignSvgCreateTool()] })
    const names = (await host.listTools({
      ...context(true),
      guiDesignMode: true,
      sandboxMode: 'read-only'
    })).map((tool) => tool.name)
    expect(names).not.toContain(DESIGN_SVG_CREATE_TOOL_NAME)
  })

  it('normalizes design_create_screen calls to screen ops', async () => {
    const tool = createDesignCreateScreenTool()
    expect(tool.name).toBe(DESIGN_CREATE_SCREEN_TOOL_NAME)
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
    expect(JSON.stringify(tool.inputSchema)).toContain('Web -> desktop 1280x800')
    expect(JSON.stringify(tool.inputSchema)).toContain('App -> mobile 390x844')
    expect(JSON.stringify(tool.inputSchema)).toContain('Omit it unless the user asks for a custom size')
    expect(JSON.stringify(tool.inputSchema)).toContain('omitted dimensions follow the current Design target')
    expect(JSON.stringify(tool.inputSchema)).toContain('avoid existing shapes, images, frames')
    expect(tool.description).toContain('current canvas snapshot')
    expect(tool.description).toContain('do not cover existing images or frames')
    expect(tool.description).toContain('Code-mode whiteboard creates plain editable frame shapes')
    expect(JSON.stringify(tool.inputSchema)).toContain('Code-mode whiteboard keeps it as frame context only')
    const result = await tool.execute(
      { name: 'Home', brief: 'Dashboard home', devicePreset: 'desktop' },
      context()
    )
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_CREATE_SCREEN_TOOL_NAME,
      ops: [{ op: 'add-screen', name: 'Home', brief: 'Dashboard home', devicePreset: 'desktop' }]
    })
  })

  it('normalizes design_update_shapes calls to renderer ops', async () => {
    const tool = createDesignUpdateShapesTool()
    expect(tool.name).toBe(DESIGN_UPDATE_SHAPES_TOOL_NAME)
    expect(JSON.stringify(tool.inputSchema)).toContain('direct top-level ShapeOp')
    expect(tool.description).toContain('inspect the current canvas snapshot first')
    const op = { op: 'add', shape: { type: 'rect', width: 40, height: 40 } }
    const result = await tool.execute({ ops: op }, context())
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [op]
    })
  })

  it('accepts a direct top-level ShapeOp when the model omits ops', async () => {
    const tool = createDesignUpdateShapesTool()
    const op = {
      op: 'update',
      id: 'shape_1',
      patch: { imageUrl: '.deepseekgui-images/img.png' }
    }
    const result = await tool.execute(op, context())

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [op]
    })
  })

  it('normalizes loose update arguments into a ShapeOp', async () => {
    const tool = createDesignUpdateShapesTool()
    const result = await tool.execute(
      {
        shape_id: 'slot_1',
        relative_path: '.deepseekgui-images/img-slot.png'
      },
      context()
    )

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [
        {
          op: 'update',
          id: 'slot_1',
          patch: { imageUrl: '.deepseekgui-images/img-slot.png' }
        }
      ]
    })
  })

  it('queues a structured project design-system operation without board placement', async () => {
    const tool = createDesignSystemTemplateTool()
    expect(tool.name).toBe(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME)
    expect(JSON.stringify(tool.inputSchema)).toContain('Web -> saas/web components')
    expect(JSON.stringify(tool.inputSchema)).toContain('App -> mobile/app components')
    expect(tool.name).toBe('design_system')
    expect(tool.description).toContain('.kun-design/design-system.json')
    expect(tool.description).toContain('never draws an HTML, SVG, or freeform style-kit board')
    const result = await tool.execute(
      { name: 'IKUN World', seedColor: '#D4AF37', mode: 'dark', template: 'game' },
      context()
    )
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
      ops: [
        {
          op: 'design-system-template',
          operation: 'create',
          name: 'IKUN World',
          seedColor: '#D4AF37',
          mode: 'dark',
          template: 'game'
        }
      ]
    })
    expect(JSON.stringify(result.output)).not.toContain('"x"')
    expect(JSON.stringify(result.output)).not.toContain('"y"')
  })

  it('preserves target ids for design-system validation tools', async () => {
    const templateTool = createDesignSystemTemplateTool()
    const templateResult = await templateTool.execute(
      { operation: 'validate', targetIds: ['screen-1', 42, 'button-1'] },
      context()
    )
    expect(templateResult.output).toMatchObject({
      ok: true,
      tool: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
      ops: [{ op: 'lint-design-system', targetIds: ['screen-1', 'button-1'] }]
    })

    const validateTool = createDesignValidateTool()
    expect(validateTool.name).toBe(DESIGN_VALIDATE_TOOL_NAME)
    const validateResult = await validateTool.execute(
      { targetIds: ['card-1', null, 'card-label'] },
      context()
    )
    expect(validateResult.output).toMatchObject({
      ok: true,
      tool: DESIGN_VALIDATE_TOOL_NAME,
      ops: [{ op: 'lint-design-system', targetIds: ['card-1', 'card-label'] }]
    })
  })

  it('normalizes structured tokens, captured components, variants, and deletions', async () => {
    const tool = createDesignSystemTemplateTool()
    const result = await tool.execute({
      operation: 'update',
      tokens: [{ name: 'brand/primary', kind: 'color', value: '#2563eb' }],
      captureComponents: [{ name: 'Button', fromId: 'shape_button', slots: [{ path: 'label', kind: 'text' }] }],
      variants: [{
        component: 'Button',
        key: 'size=small',
        selection: { size: 'small' },
        overrides: { shape_button: { width: 96 } }
      }],
      deleteTokenNames: ['legacy/color'],
      deleteComponentNames: ['LegacyCard']
    }, context())

    expect(result.output).toMatchObject({
      ok: true,
      tool: 'design_system',
      ops: [
        { op: 'define-token', name: 'brand/primary', kind: 'color', value: '#2563eb' },
        { op: 'define-component', name: 'Button', fromId: 'shape_button' },
        { op: 'set-component-variant', name: 'Button', key: 'size=small' },
        { op: 'delete-token', name: 'legacy/color' },
        { op: 'delete-component', name: 'LegacyCard' }
      ]
    })
    expect(JSON.stringify(result.output)).not.toContain('design-system-template')
  })
})
