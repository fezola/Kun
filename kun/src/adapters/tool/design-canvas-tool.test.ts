import { describe, expect, it } from 'vitest'
import {
  createDesignCanvasTool,
  createDesignCreateScreenTool,
  createDesignSystemTemplateTool,
  createDesignUpdateShapesTool,
  DESIGN_CANVAS_TOOL_NAME,
  DESIGN_CREATE_SCREEN_TOOL_NAME,
  DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
  DESIGN_UPDATE_SHAPES_TOOL_NAME
} from './design-canvas-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

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
  it('normalizes design_create_screen calls to screen ops', async () => {
    const tool = createDesignCreateScreenTool()
    expect(tool.name).toBe(DESIGN_CREATE_SCREEN_TOOL_NAME)
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
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
    const op = { op: 'add', shape: { type: 'rect', width: 40, height: 40 } }
    const result = await tool.execute({ ops: op }, context())
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [op]
    })
  })

  it('queues a high-level design-system-template op', async () => {
    const tool = createDesignSystemTemplateTool()
    expect(tool.name).toBe(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME)
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
  })
})
