import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const DESIGN_CANVAS_TOOL_NAME = 'design_canvas'
export const DESIGN_CREATE_SCREEN_TOOL_NAME = 'design_create_screen'
export const DESIGN_UPDATE_SHAPES_TOOL_NAME = 'design_update_shapes'
export const DESIGN_ARRANGE_TOOL_NAME = 'design_arrange'
export const DESIGN_SYSTEM_TEMPLATE_TOOL_NAME = 'design_system_template'
export const DESIGN_VALIDATE_TOOL_NAME = 'design_validate'

export const DESIGN_CANVAS_MUTATION_TOOL_NAMES = [
  DESIGN_CANVAS_TOOL_NAME,
  DESIGN_CREATE_SCREEN_TOOL_NAME,
  DESIGN_UPDATE_SHAPES_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
  DESIGN_VALIDATE_TOOL_NAME
] as const

type DesignCanvasAction = 'create_board' | 'add_screen' | 'update_shapes'
type DesignScreenSpec = {
  name: string
  brief?: string
  x?: number
  y?: number
  width?: number
  height?: number
  devicePreset?: 'mobile' | 'tablet' | 'desktop'
}

const SHOULD_ADVERTISE_DESIGN_TOOL = (context: { guiDesignCanvas?: boolean }) =>
  context.guiDesignCanvas === true

export function buildDesignCanvasLocalTools(): LocalTool[] {
  return [
    createDesignCanvasTool(),
    createDesignCreateScreenTool(),
    createDesignUpdateShapesTool(),
    createDesignArrangeTool(),
    createDesignSystemTemplateTool(),
    createDesignValidateTool()
  ]
}

export function createDesignCanvasTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_CANVAS_TOOL_NAME,
    description: [
      'Create or update the GUI design canvas. Use this only when Kun is in a design canvas turn.',
      'The renderer applies the returned operations to the active canvas; do not emit markdown code blocks for canvas operations.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_board', 'add_screen', 'update_shapes'],
          description:
            'create_board is optional/no-op; add_screen creates an HTML screen frame; update_shapes applies vector/image shape ops.'
        },
        title: {
          type: 'string',
          description: 'Optional board title for create_board.'
        },
        name: {
          type: 'string',
          description: 'Screen name for add_screen.'
        },
        brief: {
          type: 'string',
          description: 'Self-contained screen brief for add_screen; the renderer uses it for follow-up HTML generation.'
        },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        devicePreset: {
          type: 'string',
          enum: ['mobile', 'tablet', 'desktop']
        },
        ops: {
          description:
            'For update_shapes: a ShapeOp object or array of ShapeOps. ShapeOps are validated and applied by the renderer.',
          anyOf: [
            { type: 'object', additionalProperties: true },
            { type: 'array', items: { type: 'object', additionalProperties: true } }
          ]
        }
      },
      required: ['action'],
      additionalProperties: true
    },
    execute: async (args) => {
      const normalized = normalizeDesignCanvasArgs(args)
      if (!normalized.ok) {
        return {
          output: {
            ok: false,
            error: normalized.error
          },
          isError: true
        }
      }
      return {
        output: {
          ok: true,
          action: normalized.action,
          ops: normalized.ops,
          message: normalized.message
        }
      }
    }
  })
}

export function createDesignCreateScreenTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_CREATE_SCREEN_TOOL_NAME,
    description: [
      'Create one or more GUI design canvas screen frames. Prefer this over design_canvas action=add_screen.',
      'The renderer places omitted coordinates in the current whiteboard viewport and generates screen HTML afterwards.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Screen name for a single screen.' },
        brief: { type: 'string', description: 'Self-contained screen brief for follow-up HTML generation.' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        devicePreset: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] },
        screens: {
          type: 'array',
          maxItems: 20,
          description: 'Optional batch of screen specs. When present, name/brief/x/y/width/height are ignored.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              brief: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              devicePreset: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] }
            },
            required: ['name'],
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    execute: async (args) => {
      const screens = normalizeScreenSpecs(args)
      if (!screens.ok) return designToolError(screens.error)
      const ops = screens.specs.length === 1
        ? [{ op: 'add-screen', ...screens.specs[0] }]
        : [{ op: 'add-screens', specs: screens.specs }]
      return designToolOutput(DESIGN_CREATE_SCREEN_TOOL_NAME, 'create_screen', ops)
    }
  })
}

export function createDesignUpdateShapesTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_UPDATE_SHAPES_TOOL_NAME,
    description: [
      'Apply validated shape operations to the active design canvas: add, update, delete, move, resize, style, token, component, and image changes.',
      'Use this for whiteboard/vector edits. Use design_create_screen for new screen frames and design_system_template for style-kit boards.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          description: 'A ShapeOp object or array of ShapeOps. The renderer validates and applies each op atomically.',
          anyOf: [
            { type: 'object', additionalProperties: true },
            { type: 'array', items: { type: 'object', additionalProperties: true } }
          ]
        }
      },
      required: ['ops'],
      additionalProperties: false
    },
    execute: async (args) => {
      const ops = normalizeOps(args.ops)
      if (!ops) return designToolError('design_update_shapes requires ops as an object or array')
      return designToolOutput(DESIGN_UPDATE_SHAPES_TOOL_NAME, 'update_shapes', ops)
    }
  })
}

export function createDesignArrangeTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_ARRANGE_TOOL_NAME,
    description: [
      'Arrange existing canvas objects with alignment, distribution, stacking, grid layout, or responsive reflow.',
      'This keeps whiteboard layout operations explicit and avoids mixing arrangement intent with low-level shape edits.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['align', 'distribute', 'stack', 'grid', 'responsive_reflow']
        },
        ids: { type: 'array', items: { type: 'string' } },
        id: { type: 'string' },
        frameId: { type: 'string' },
        axis: {
          type: 'string',
          enum: ['left', 'h-center', 'right', 'top', 'v-center', 'bottom', 'horizontal', 'vertical']
        },
        direction: { type: 'string', enum: ['horizontal', 'vertical'] },
        cols: { type: 'number' },
        gap: { type: 'number' },
        rowGap: { type: 'number' },
        colGap: { type: 'number' },
        name: { type: 'string' },
        asFrame: { type: 'boolean' },
        device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] }
      },
      required: ['operation'],
      additionalProperties: false
    },
    execute: async (args) => {
      const normalized = normalizeArrangeOp(args)
      if (!normalized.ok) return designToolError(normalized.error)
      return designToolOutput(DESIGN_ARRANGE_TOOL_NAME, 'arrange', [normalized.op])
    }
  })
}

export function createDesignSystemTemplateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
    description: [
      'Create, update, apply, or validate a reusable design-system style-kit board.',
      'The renderer turns this into tokens, reusable component specimens, color/type/spacing samples, and a cohesive template board.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'update', 'apply', 'validate'] },
        name: { type: 'string' },
        seedColor: { type: 'string', description: 'Primary brand color as #RRGGBB. Defaults to a calibrated blue.' },
        mode: { type: 'string', enum: ['light', 'dark', 'both'] },
        template: { type: 'string', enum: ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio'] },
        tone: { type: 'string', enum: ['clean', 'playful', 'premium', 'technical', 'editorial'] },
        sections: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['palette', 'typography', 'buttons', 'forms', 'navigation', 'cards', 'icons', 'states', 'spacing', 'radius', 'shadow']
          }
        },
        targetIds: { type: 'array', items: { type: 'string' } },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        dryRun: { type: 'boolean' }
      },
      additionalProperties: false
    },
    execute: async (args) => {
      const operation = oneOf(args.operation, ['create', 'update', 'apply', 'validate']) ?? 'create'
      if (operation === 'validate') {
        return designToolOutput(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME, 'validate_design_system', [
          { op: 'lint-design-system' }
        ])
      }
      return designToolOutput(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME, 'design_system_template', [
        {
          op: 'design-system-template',
          operation,
          ...(stringArg(args.name) ? { name: stringArg(args.name) } : {}),
          ...(stringArg(args.seedColor) ? { seedColor: stringArg(args.seedColor) } : {}),
          ...(oneOf(args.mode, ['light', 'dark', 'both']) ? { mode: oneOf(args.mode, ['light', 'dark', 'both']) } : {}),
          ...(oneOf(args.template, ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio'])
            ? { template: oneOf(args.template, ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio']) }
            : {}),
          ...(oneOf(args.tone, ['clean', 'playful', 'premium', 'technical', 'editorial'])
            ? { tone: oneOf(args.tone, ['clean', 'playful', 'premium', 'technical', 'editorial']) }
            : {}),
          ...(Array.isArray(args.sections) ? { sections: args.sections.filter((v): v is string => typeof v === 'string') } : {}),
          ...(Array.isArray(args.targetIds) ? { targetIds: args.targetIds.filter((v): v is string => typeof v === 'string') } : {}),
          ...(numberArg(args.x) !== undefined ? { x: numberArg(args.x) } : {}),
          ...(numberArg(args.y) !== undefined ? { y: numberArg(args.y) } : {}),
          ...(numberArg(args.width) !== undefined ? { width: numberArg(args.width) } : {}),
          ...(numberArg(args.height) !== undefined ? { height: numberArg(args.height) } : {}),
          ...(args.dryRun === true ? { dryRun: true } : {})
        }
      ])
    }
  })
}

export function createDesignValidateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_VALIDATE_TOOL_NAME,
    description:
      'Run design-system validation on the current canvas. Findings are surfaced to the next design turn for repair.',
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async () =>
      designToolOutput(DESIGN_VALIDATE_TOOL_NAME, 'validate_design_system', [{ op: 'lint-design-system' }])
  })
}

function normalizeDesignCanvasArgs(args: Record<string, unknown>):
  | { ok: true; action: DesignCanvasAction; ops: unknown[]; message: string }
  | { ok: false; error: string } {
  const action = args.action
  if (action !== 'create_board' && action !== 'add_screen' && action !== 'update_shapes') {
    return { ok: false, error: 'action must be one of create_board, add_screen, or update_shapes' }
  }
  if (action === 'create_board') {
    return {
      ok: true,
      action,
      ops: [],
      message: 'Design board is ready.'
    }
  }
  if (action === 'add_screen') {
    const op = copyOptionalFields(
      {
        op: 'add-screen',
        name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Screen'
      },
      args,
      ['brief', 'x', 'y', 'width', 'height', 'devicePreset']
    )
    return {
      ok: true,
      action,
      ops: [op],
      message: `Queued screen "${String(op.name)}" for the design canvas.`
    }
  }
  const ops = normalizeOps(args.ops)
  if (!ops) {
    return { ok: false, error: 'update_shapes requires ops as an object or array' }
  }
  return {
    ok: true,
    action,
    ops,
    message: `Queued ${ops.length} shape operation${ops.length === 1 ? '' : 's'} for the design canvas.`
  }
}

function normalizeScreenSpecs(args: Record<string, unknown>):
  | { ok: true; specs: DesignScreenSpec[] }
  | { ok: false; error: string } {
  if (Array.isArray(args.screens)) {
    const specs = args.screens.map(normalizeScreenSpec).filter(Boolean) as DesignScreenSpec[]
    if (specs.length === 0) return { ok: false, error: 'screens must contain at least one valid screen spec' }
    return { ok: true, specs }
  }
  const spec = normalizeScreenSpec(args)
  if (!spec) return { ok: false, error: 'name is required for design_create_screen' }
  return { ok: true, specs: [spec] }
}

function normalizeScreenSpec(value: unknown): DesignScreenSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : ''
  if (!name) return null
  return copyOptionalFields({ name }, source, ['brief', 'x', 'y', 'width', 'height', 'devicePreset']) as DesignScreenSpec
}

function normalizeArrangeOp(args: Record<string, unknown>):
  | { ok: true; op: Record<string, unknown> }
  | { ok: false; error: string } {
  const operation = args.operation
  const ids = Array.isArray(args.ids) ? args.ids.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
  if (operation === 'align') {
    const axis = oneOf(args.axis, ['left', 'h-center', 'right', 'top', 'v-center', 'bottom'])
    if (ids.length < 2 || !axis) return { ok: false, error: 'align requires ids (2+) and axis' }
    return { ok: true, op: { op: 'align', ids, axis } }
  }
  if (operation === 'distribute') {
    const axis = oneOf(args.axis, ['horizontal', 'vertical'])
    if (ids.length < 3 || !axis) return { ok: false, error: 'distribute requires ids (3+) and axis horizontal|vertical' }
    return { ok: true, op: { op: 'distribute', ids, axis } }
  }
  if (operation === 'stack') {
    const direction = oneOf(args.direction, ['horizontal', 'vertical'])
    if (ids.length < 1 || !direction) return { ok: false, error: 'stack requires ids and direction' }
    return {
      ok: true,
      op: {
        op: 'stack',
        ids,
        direction,
        ...(numberArg(args.gap) !== undefined ? { gap: numberArg(args.gap) } : {}),
        ...(stringArg(args.name) ? { name: stringArg(args.name) } : {}),
        ...(args.asFrame === true ? { asFrame: true } : {})
      }
    }
  }
  if (operation === 'grid') {
    const id = stringArg(args.id)
    const cols = numberArg(args.cols)
    if (!id || !cols) return { ok: false, error: 'grid requires id and positive cols' }
    return {
      ok: true,
      op: {
        op: 'grid',
        id,
        cols,
        ...(numberArg(args.rowGap) !== undefined ? { rowGap: numberArg(args.rowGap) } : {}),
        ...(numberArg(args.colGap) !== undefined ? { colGap: numberArg(args.colGap) } : {})
      }
    }
  }
  if (operation === 'responsive_reflow') {
    const frameId = stringArg(args.frameId) || stringArg(args.id)
    const device = oneOf(args.device, ['mobile', 'tablet', 'desktop'])
    if (!frameId || !device) return { ok: false, error: 'responsive_reflow requires frameId and device' }
    return { ok: true, op: { op: 'responsive-reflow', frameId, device } }
  }
  return { ok: false, error: 'operation must be align, distribute, stack, grid, or responsive_reflow' }
}

function designToolOutput(tool: string, action: string, ops: unknown[]): { output: Record<string, unknown> } {
  return {
    output: {
      ok: true,
      tool,
      action,
      ops,
      message: `Queued ${ops.length} design operation${ops.length === 1 ? '' : 's'} for the design canvas.`
    }
  }
}

function designToolError(error: string): { output: Record<string, unknown>; isError: true } {
  return { output: { ok: false, error }, isError: true }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined
}

function normalizeOps(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return [value]
  return null
}

function copyOptionalFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key]
  }
  return target
}
