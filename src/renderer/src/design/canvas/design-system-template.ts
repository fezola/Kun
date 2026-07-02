import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { createDefaultShape, type CanvasShape, type ShapeType } from './canvas-types'
import { useDesignSystemStore } from './design-system-store'
import { resolveTokenPatch, type ComponentDef, type DesignToken, type TokenProp } from './design-system-types'
import type { OpError } from './shape-ops'

export type DesignSystemTemplateOperation = 'create' | 'update' | 'apply'
export type DesignSystemTemplateMode = 'light' | 'dark' | 'both'
export type DesignSystemTemplateKind = 'app' | 'saas' | 'game' | 'editor' | 'mobile' | 'portfolio'
export type DesignSystemTemplateTone = 'clean' | 'playful' | 'premium' | 'technical' | 'editorial'

export type DesignSystemTemplateOp = {
  op: 'design-system-template'
  operation: DesignSystemTemplateOperation
  name?: string
  seedColor?: string
  mode?: DesignSystemTemplateMode
  template?: DesignSystemTemplateKind
  tone?: DesignSystemTemplateTone
  sections?: string[]
  targetIds?: string[]
  x?: number
  y?: number
  width?: number
  height?: number
  dryRun?: boolean
}

type TemplateFoundation = {
  name: string
  mode: Exclude<DesignSystemTemplateMode, 'both'>
  tokenPrefix?: 'light' | 'dark'
  tokens: DesignToken[]
  colors: {
    primary: string
    secondary: string
    tertiary: string
    neutral: string
    canvas: string
    card: string
    elevated: string
    text: string
    muted: string
    border: string
    success: string
    warning: string
    danger: string
  }
  fonts: {
    headline: string
    body: string
    label: string
  }
}

const DEFAULT_SEED = '#3B82D8'

export function applyDesignSystemTemplateOp(
  op: DesignSystemTemplateOp,
  affectedIds: Set<string>,
  errors: OpError[]
): void {
  if (op.dryRun) return

  if (op.mode === 'both') {
    const baseName = cleanName(op.name) || 'Design System'
    const defaultFoundation = buildFoundation({ ...op, name: baseName, mode: 'dark' })
    const darkFoundation = buildFoundation({ ...op, name: `${baseName} Dark`, mode: 'dark' }, 'dark')
    const lightFoundation = buildFoundation({ ...op, name: `${baseName} Light`, mode: 'light' }, 'light')
    upsertTokens(defaultFoundation.tokens, op.targetIds, affectedIds)
    upsertTokens(darkFoundation.tokens, op.targetIds, affectedIds)
    upsertTokens(lightFoundation.tokens, op.targetIds, affectedIds)
    registerTemplateComponents(defaultFoundation)
    if (op.operation !== 'apply') {
      const width = positive(op.width) ?? 1580
      const x = finite(op.x)
      createTemplateBoard({ ...op, mode: 'dark', width, ...(x === undefined ? {} : { x }) }, darkFoundation, affectedIds, errors)
      createTemplateBoard(
        { ...op, mode: 'light', width, ...(x === undefined ? {} : { x: x + width + 80 }) },
        lightFoundation,
        affectedIds,
        errors
      )
    }
    return
  }

  const foundation = buildFoundation(op)
  upsertTokens(foundation.tokens, op.targetIds, affectedIds)
  registerTemplateComponents(foundation)
  if (op.operation !== 'apply') {
    createTemplateBoard(op, foundation, affectedIds, errors)
  }
}

function buildFoundation(
  op: DesignSystemTemplateOp,
  tokenPrefix?: TemplateFoundation['tokenPrefix']
): TemplateFoundation {
  const mode = op.mode === 'light' ? 'light' : 'dark'
  const primary = normalizeHex(op.seedColor) ?? DEFAULT_SEED
  const secondary = rotateHue(primary, op.template === 'game' || op.tone === 'playful' ? 86 : 42)
  const tertiary = mode === 'dark' ? '#050505' : '#111827'
  const neutral = mode === 'dark' ? '#F8FAFC' : '#FFFFFF'
  const canvas = mode === 'dark' ? '#111313' : '#F7F7F2'
  const card = mode === 'dark' ? '#1C1F1F' : '#FFFFFF'
  const elevated = mode === 'dark' ? '#262A2A' : '#ECEAE2'
  const text = mode === 'dark' ? '#F3F0E7' : '#171717'
  const muted = mode === 'dark' ? '#AFA792' : '#68645A'
  const border = mode === 'dark' ? mix(primary, '#111313', 0.52) : mix(primary, '#FFFFFF', 0.78)
  const fonts = fontStack(op.template, op.tone)
  const name = cleanName(op.name) || 'Design System'
  const tn = (value: string) => tokenPrefix ? `${tokenPrefix}/${value}` : value

  return {
    name,
    mode,
    ...(tokenPrefix ? { tokenPrefix } : {}),
    colors: {
      primary,
      secondary,
      tertiary,
      neutral,
      canvas,
      card,
      elevated,
      text,
      muted,
      border,
      success: '#16A34A',
      warning: '#D97706',
      danger: '#DC2626'
    },
    fonts,
    tokens: [
      { name: tn('brand/primary'), kind: 'color', value: primary },
      { name: tn('brand/secondary'), kind: 'color', value: secondary },
      { name: tn('brand/tertiary'), kind: 'color', value: tertiary },
      { name: tn('neutral/0'), kind: 'color', value: neutral },
      { name: tn('surface/canvas'), kind: 'color', value: canvas },
      { name: tn('surface/card'), kind: 'color', value: card },
      { name: tn('surface/elevated'), kind: 'color', value: elevated },
      { name: tn('text/primary'), kind: 'color', value: text },
      { name: tn('text/muted'), kind: 'color', value: muted },
      { name: tn('border/default'), kind: 'color', value: border },
      { name: tn('state/success'), kind: 'color', value: '#16A34A' },
      { name: tn('state/warning'), kind: 'color', value: '#D97706' },
      { name: tn('state/danger'), kind: 'color', value: '#DC2626' },
      {
        name: tn('type/headline'),
        kind: 'type',
        value: { fontSize: 72, fontWeight: 700, fontFamily: fonts.headline, lineHeight: 1.05, fontColor: text }
      },
      {
        name: tn('type/body'),
        kind: 'type',
        value: { fontSize: 48, fontWeight: 500, fontFamily: fonts.body, lineHeight: 1.2, fontColor: muted }
      },
      {
        name: tn('type/label'),
        kind: 'type',
        value: { fontSize: 24, fontWeight: 600, fontFamily: fonts.label, lineHeight: 1.25, fontColor: muted }
      },
      { name: tn('space/sm'), kind: 'space', value: 8 },
      { name: tn('space/md'), kind: 'space', value: 16 },
      { name: tn('space/lg'), kind: 'space', value: 28 },
      { name: tn('radius/control'), kind: 'radius', value: 8 },
      { name: tn('radius/card'), kind: 'radius', value: 28 },
      {
        name: tn('shadow/card'),
        kind: 'shadow',
        value: [{ type: 'drop', x: 0, y: 18, blur: 48, spread: 0, color: '#000000', opacity: mode === 'dark' ? 0.32 : 0.14 }]
      }
    ]
  }
}

function upsertTokens(tokens: DesignToken[], targetIds: string[] | undefined, affectedIds: Set<string>): void {
  const ds = useDesignSystemStore.getState()
  const store = useCanvasShapeStore.getState()
  const tokenByName = new Map(tokens.map((token) => [token.name, token]))
  const scope = targetIds && targetIds.length > 0 ? collectScope(targetIds) : null
  for (const token of tokens) ds.setToken(token)

  for (const id of store.getAllShapeIds()) {
    if (scope && !scope.has(id)) continue
    const shape = store.getShape(id)
    if (!shape?.tokenBindings) continue
    const patch: Partial<CanvasShape> = {}
    let changed = false
    for (const [prop, tokenName] of Object.entries(shape.tokenBindings)) {
      const token = tokenByName.get(tokenName)
      if (!token) continue
      const resolved = resolveTokenPatch(token, prop as TokenProp, shape)
      if ('error' in resolved) continue
      Object.assign(patch, resolved)
      changed = true
    }
    if (changed) {
      store.updateShape(id, patch)
      affectedIds.add(id)
    }
  }
}

function registerTemplateComponents(foundation: TemplateFoundation): void {
  const ds = useDesignSystemStore.getState()
  for (const component of [
    buttonComponent(foundation),
    searchInputComponent(foundation),
    cardComponent(foundation)
  ]) {
    ds.setComponent(component)
  }
}

function buttonComponent(foundation: TemplateFoundation): ComponentDef {
  const root = componentShape('rect', 'Button', {
    width: 150,
    height: 48,
    cornerRadius: 8,
    fills: [{ type: 'solid', color: foundation.colors.primary, opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: 'brand/primary', radius: 'radius/control' })
  })
  const label = componentShape('text', 'label', {
    parentId: root.id,
    x: 28,
    y: 12,
    width: 94,
    height: 24,
    textContent: 'Button',
    fontSize: 18,
    fontFamily: foundation.fonts.label,
    fontWeight: 700,
    fontColor: foundation.colors.tertiary,
    tokenBindings: bindTokens(foundation, { font: 'type/label', 'text-color': 'brand/tertiary' })
  })
  root.children = [label.id]
  return {
    id: 'component/button',
    name: 'Button',
    version: 1,
    tree: [root, label],
    slots: [{ path: 'label', kind: 'text', label: 'Label' }]
  }
}

function searchInputComponent(foundation: TemplateFoundation): ComponentDef {
  const root = componentShape('frame', 'SearchInput', {
    width: 300,
    height: 62,
    cornerRadius: 8,
    fills: [{ type: 'solid', color: foundation.colors.elevated, opacity: 1 }],
    strokes: [{ color: foundation.colors.border, width: 2, opacity: 1, position: 'inside' }],
    tokenBindings: bindTokens(foundation, { fill: 'surface/elevated', stroke: 'border/default', radius: 'radius/control' })
  })
  const label = componentShape('text', 'placeholder', {
    parentId: root.id,
    x: 64,
    y: 17,
    width: 150,
    height: 28,
    textContent: 'Search',
    fontSize: 20,
    fontFamily: foundation.fonts.label,
    fontWeight: 600,
    fontColor: foundation.colors.muted,
    tokenBindings: bindTokens(foundation, { font: 'type/label', 'text-color': 'text/muted' })
  })
  root.children = [label.id]
  return {
    id: 'component/search-input',
    name: 'SearchInput',
    version: 1,
    tree: [root, label],
    slots: [{ path: 'placeholder', kind: 'text', label: 'Placeholder' }]
  }
}

function cardComponent(foundation: TemplateFoundation): ComponentDef {
  const root = componentShape('frame', 'Card', {
    width: 280,
    height: 180,
    cornerRadius: 28,
    fills: [{ type: 'solid', color: foundation.colors.card, opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: 'surface/card', radius: 'radius/card', shadow: 'shadow/card' }),
    shadows: [{ type: 'drop', x: 0, y: 18, blur: 48, spread: 0, color: '#000000', opacity: foundation.mode === 'dark' ? 0.32 : 0.14 }]
  })
  const title = componentShape('text', 'title', {
    parentId: root.id,
    x: 24,
    y: 26,
    width: 220,
    height: 34,
    textContent: 'Card title',
    fontSize: 24,
    fontFamily: foundation.fonts.label,
    fontWeight: 700,
    fontColor: foundation.colors.text,
    tokenBindings: bindTokens(foundation, { font: 'type/label', 'text-color': 'text/primary' })
  })
  const body = componentShape('text', 'body', {
    parentId: root.id,
    x: 24,
    y: 78,
    width: 220,
    height: 74,
    textContent: 'Reusable content block',
    fontSize: 18,
    fontFamily: foundation.fonts.body,
    fontWeight: 500,
    fontColor: foundation.colors.muted,
    tokenBindings: bindTokens(foundation, { font: 'type/body', 'text-color': 'text/muted' })
  })
  root.children = [title.id, body.id]
  return {
    id: 'component/card',
    name: 'Card',
    version: 1,
    tree: [root, title, body],
    slots: [
      { path: 'title', kind: 'text', label: 'Title' },
      { path: 'body', kind: 'text', label: 'Body' }
    ]
  }
}

function componentShape(type: ShapeType, name: string, patch: Partial<CanvasShape>): CanvasShape {
  const shape = createDefaultShape(type, patch.x ?? 0, patch.y ?? 0)
  Object.assign(shape, patch, { name })
  return shape
}

function tokenName(foundation: TemplateFoundation, token: string): string {
  return foundation.tokenPrefix ? `${foundation.tokenPrefix}/${token}` : token
}

function bindTokens(foundation: TemplateFoundation, bindings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bindings).map(([prop, token]) => [prop, tokenName(foundation, token)])
  )
}

function collectScope(rootIds: string[]): Set<string> {
  const store = useCanvasShapeStore.getState()
  const out = new Set<string>()
  const visit = (id: string): void => {
    if (out.has(id)) return
    const shape = store.getShape(id)
    if (!shape) return
    out.add(id)
    for (const child of shape.children) visit(child)
  }
  for (const id of rootIds) visit(id)
  return out
}

function createTemplateBoard(
  op: DesignSystemTemplateOp,
  foundation: TemplateFoundation,
  affectedIds: Set<string>,
  errors: OpError[]
): void {
  const viewport = useCanvasViewportStore.getState().vbox
  const width = positive(op.width) ?? 1580
  const height = positive(op.height) ?? 880
  const x = finite(op.x) ?? Math.round(viewport.x + 80)
  const y = finite(op.y) ?? Math.round(viewport.y + 80)
  const board = addShape('frame', {
    name: `${foundation.name} Style Kit`,
    x,
    y,
    width,
    height,
    cornerRadius: 30,
    clipContent: true,
    fills: [{ type: 'solid', color: foundation.colors.canvas, opacity: 1 }],
    strokes: [{ color: foundation.colors.border, width: 2, opacity: 1, position: 'inside' }],
    shadows: [{ type: 'drop', x: 0, y: 28, blur: 80, spread: 0, color: '#000000', opacity: foundation.mode === 'dark' ? 0.42 : 0.18 }],
    tokenBindings: bindTokens(foundation, { fill: 'surface/canvas', stroke: 'border/default', radius: 'radius/card', shadow: 'shadow/card' })
  }, undefined, affectedIds)

  if (!board) {
    errors.push({ code: 'INVALID_OP', message: 'Could not create design-system template board' })
    return
  }

  const pad = 34
  const col1 = x + pad
  const col2 = x + 390
  const col3 = x + 790
  const col4 = x + 1180
  const top = y + pad
  addLabel(foundation, `${foundation.name}`, col1, y + 12, board, affectedIds, 'type/label')

  paletteCard(foundation, 'Primary', 'brand/primary', foundation.colors.primary, col1, top, board, affectedIds)
  paletteCard(foundation, 'Secondary', 'brand/secondary', foundation.colors.secondary, col1, top + 220, board, affectedIds)
  paletteCard(foundation, 'Tertiary', 'brand/tertiary', foundation.colors.tertiary, col1, top + 440, board, affectedIds)
  paletteCard(foundation, 'Neutral', 'neutral/0', foundation.colors.neutral, col1, top + 660, board, affectedIds)

  typeCard(foundation, 'Headline', foundation.fonts.headline, 'type/headline', col2, top, 350, 260, board, affectedIds)
  typeCard(foundation, 'Body', foundation.fonts.body, 'type/body', col2, top + 290, 350, 260, board, affectedIds)
  typeCard(foundation, 'Label', foundation.fonts.label, 'type/label', col2, top + 580, 350, 260, board, affectedIds)

  componentCard(foundation, 'Buttons', col3, top, 370, 260, board, affectedIds, (parent) => {
    button(foundation, 'Primary', col3 + 28, top + 80, 'brand/primary', 'brand/tertiary', parent, affectedIds)
    button(foundation, 'Secondary', col3 + 200, top + 80, 'surface/elevated', 'text/primary', parent, affectedIds)
    button(foundation, 'Inverted', col3 + 28, top + 146, 'neutral/0', 'brand/tertiary', parent, affectedIds)
    outlineButton(foundation, 'Outlined', col3 + 200, top + 146, parent, affectedIds)
  })

  componentCard(foundation, 'Search', col4, top, 370, 260, board, affectedIds, (parent) => {
    addShape('rect', {
      name: 'Search input',
      x: col4 + 34,
      y: top + 100,
      width: 300,
      height: 62,
      cornerRadius: 0,
      fills: [{ type: 'solid', color: foundation.colors.elevated, opacity: 1 }],
      strokes: [{ color: foundation.colors.border, width: 2, opacity: 0.7, position: 'inside' }],
      tokenBindings: bindTokens(foundation, { fill: 'surface/elevated', stroke: 'border/default' })
    }, parent, affectedIds)
    addLabel(foundation, 'Search', col4 + 98, top + 115, parent, affectedIds, 'type/label')
    addIcon(foundation, 'magnifier', col4 + 58, top + 119, parent, affectedIds)
  })

  componentCard(foundation, 'Progress', col3, top + 290, 370, 260, board, affectedIds, (parent) => {
    progress(foundation, col3 + 34, top + 102, 250, 'brand/primary', parent, affectedIds)
    progress(foundation, col3 + 34, top + 142, 292, 'brand/secondary', parent, affectedIds)
    progress(foundation, col3 + 34, top + 182, 198, 'neutral/0', parent, affectedIds)
  })

  componentCard(foundation, 'Navigation', col4, top + 290, 370, 260, board, affectedIds, (parent) => {
    addShape('rect', {
      name: 'Bottom nav surface',
      x: col4 + 42,
      y: top + 112 + 290,
      width: 285,
      height: 78,
      cornerRadius: 36,
      fills: [{ type: 'solid', color: foundation.colors.elevated, opacity: 1 }],
      tokenBindings: bindTokens(foundation, { fill: 'surface/elevated', radius: 'radius/card' })
    }, parent, affectedIds)
    iconButton(foundation, 'home', col4 + 100, top + 125 + 290, 'brand/primary', parent, affectedIds)
    addIcon(foundation, 'magnifier', col4 + 198, top + 148 + 290, parent, affectedIds)
    addIcon(foundation, 'user', col4 + 276, top + 148 + 290, parent, affectedIds)
  })

  componentCard(foundation, 'Icon Buttons', col4, top + 580, 370, 260, board, affectedIds, (parent) => {
    iconButton(foundation, 'spark', col4 + 76, top + 700, 'brand/primary', parent, affectedIds)
    iconButton(foundation, 'shapes', col4 + 146, top + 700, 'brand/secondary', parent, affectedIds)
    iconButton(foundation, 'tag', col4 + 216, top + 700, 'neutral/0', parent, affectedIds)
    iconButton(foundation, 'trash', col4 + 286, top + 700, 'state/danger', parent, affectedIds)
  })

  componentCard(foundation, 'Controls', col3, top + 580, 170, 260, board, affectedIds, (parent) => {
    iconButton(foundation, 'edit', col3 + 72, top + 700, 'neutral/0', parent, affectedIds)
  })
  componentCard(foundation, 'Label Button', col3 + 198, top + 580, 172, 260, board, affectedIds, (parent) => {
    button(foundation, 'Label', col3 + 226, top + 710, 'brand/primary', 'brand/tertiary', parent, affectedIds)
  })
}

function paletteCard(
  foundation: TemplateFoundation,
  label: string,
  token: string,
  color: string,
  x: number,
  y: number,
  parentId: string,
  affectedIds: Set<string>
): void {
  const card = addShape('frame', {
    name: `${label} palette`,
    x,
    y,
    width: 330,
    height: 190,
    cornerRadius: 24,
    fills: [{ type: 'solid', color, opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: token, radius: 'radius/card' })
  }, parentId, affectedIds)
  if (!card) return
  const textToken = label === 'Neutral' ? 'brand/tertiary' : 'text/primary'
  addLabel(foundation, label, x + 24, y + 28, card, affectedIds, 'type/label', textToken)
  addLabel(foundation, color.toUpperCase(), x + 210, y + 28, card, affectedIds, 'type/label', textToken)
  const rampY = y + 116
  for (let i = 0; i < 10; i += 1) {
    addShape('rect', {
      name: `${label} ramp ${i + 1}`,
      x: x + 28 + i * 27,
      y: rampY,
      width: 27,
      height: 58,
      fills: [{ type: 'solid', color: mix(color, i < 5 ? '#000000' : '#FFFFFF', i < 5 ? 0.72 - i * 0.12 : (i - 4) * 0.14), opacity: 1 }]
    }, card, affectedIds)
  }
}

function typeCard(
  foundation: TemplateFoundation,
  label: string,
  family: string,
  token: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string,
  affectedIds: Set<string>
): void {
  componentCard(foundation, label, x, y, width, height, parentId, affectedIds, (parent) => {
    addLabel(foundation, family.split(',')[0] ?? family, x + width - 170, y + 30, parent, affectedIds, 'type/label')
    addShape('text', {
      name: `${label} specimen`,
      x: x + 120,
      y: y + 82,
      width: 180,
      height: 120,
      textContent: 'Aa',
      fontFamily: family,
      fontSize: label === 'Label' ? 112 : 132,
      fontWeight: label === 'Headline' ? 700 : 600,
      lineHeight: 1,
      fontColor: label === 'Headline' ? foundation.colors.text : foundation.colors.muted,
      tokenBindings: bindTokens(foundation, { font: token, 'text-color': label === 'Headline' ? 'text/primary' : 'text/muted' })
    }, parent, affectedIds)
  })
}

function componentCard(
  foundation: TemplateFoundation,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string,
  affectedIds: Set<string>,
  children?: (parentId: string) => void
): void {
  const card = addShape('frame', {
    name: `${label} card`,
    x,
    y,
    width,
    height,
    cornerRadius: 22,
    fills: [{ type: 'solid', color: foundation.colors.card, opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: 'surface/card', radius: 'radius/card' })
  }, parentId, affectedIds)
  if (!card) return
  addLabel(foundation, label, x + 24, y + 28, card, affectedIds, 'type/label')
  children?.(card)
}

function button(
  foundation: TemplateFoundation,
  label: string,
  x: number,
  y: number,
  fillToken: string,
  textToken: string,
  parentId: string,
  affectedIds: Set<string>
): void {
  const btn = addShape('rect', {
    name: `${label} button`,
    x,
    y,
    width: 150,
    height: 52,
    cornerRadius: 0,
    fills: [{ type: 'solid', color: tokenColor(foundation, fillToken), opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: fillToken, radius: 'radius/control' })
  }, parentId, affectedIds)
  if (btn) addLabel(foundation, label, x + 34, y + 14, btn, affectedIds, 'type/label', textToken)
}

function outlineButton(
  foundation: TemplateFoundation,
  xlabel: string,
  x: number,
  y: number,
  parentId: string,
  affectedIds: Set<string>
): void {
  const btn = addShape('rect', {
    name: `${xlabel} button`,
    x,
    y,
    width: 150,
    height: 52,
    cornerRadius: 0,
    fills: [{ type: 'solid', color: 'transparent', opacity: 0 }],
    strokes: [{ color: tokenColor(foundation, 'border/default'), width: 2, opacity: 1, position: 'inside' }],
    tokenBindings: bindTokens(foundation, { stroke: 'border/default', radius: 'radius/control' })
  }, parentId, affectedIds)
  if (btn) addLabel(foundation, xlabel, x + 34, y + 14, btn, affectedIds, 'type/label')
}

function progress(
  foundation: TemplateFoundation,
  x: number,
  y: number,
  filledWidth: number,
  token: string,
  parentId: string,
  affectedIds: Set<string>
): void {
  addShape('rect', {
    name: 'Progress track',
    x,
    y,
    width: 310,
    height: 10,
    fills: [{ type: 'solid', color: foundation.colors.elevated, opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: 'surface/elevated' })
  }, parentId, affectedIds)
  addShape('rect', {
    name: 'Progress value',
    x,
    y,
    width: filledWidth,
    height: 10,
    fills: [{ type: 'solid', color: tokenColor(foundation, token), opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: token })
  }, parentId, affectedIds)
}

function iconButton(
  foundation: TemplateFoundation,
  icon: string,
  x: number,
  y: number,
  fillToken: string,
  parentId: string,
  affectedIds: Set<string>
): void {
  const buttonId = addShape('rect', {
    name: `${icon} icon button`,
    x,
    y,
    width: 52,
    height: 52,
    cornerRadius: 0,
    fills: [{ type: 'solid', color: tokenColor(foundation, fillToken), opacity: 1 }],
    tokenBindings: bindTokens(foundation, { fill: fillToken, radius: 'radius/control' })
  }, parentId, affectedIds)
  if (buttonId) addIcon(foundation, icon, x + 16, y + 16, buttonId, affectedIds)
}

function addIcon(
  foundation: TemplateFoundation,
  icon: string,
  x: number,
  y: number,
  parentId: string,
  affectedIds: Set<string>
): void {
  addShape('text', {
    name: `${icon} icon`,
    x,
    y,
    width: 34,
    height: 28,
    textContent: iconGlyph(icon),
    fontSize: 24,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontWeight: 700,
    fontColor: tokenColor(foundation, 'text/muted'),
    tokenBindings: bindTokens(foundation, { 'text-color': 'text/muted', font: 'type/label' })
  }, parentId, affectedIds)
}

function addLabel(
  foundation: TemplateFoundation,
  text: string,
  x: number,
  y: number,
  parentId: string,
  affectedIds: Set<string>,
  fontToken = 'type/label',
  colorToken = 'text/muted'
): void {
  addShape('text', {
    name: `${text} label`,
    x,
    y,
    width: Math.max(90, text.length * 14),
    height: 34,
    textContent: text,
    fontSize: 20,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontWeight: 600,
    lineHeight: 1.2,
    fontColor: tokenColor(foundation, colorToken),
    tokenBindings: bindTokens(foundation, { font: fontToken, 'text-color': colorToken })
  }, parentId, affectedIds)
}

function addShape(
  type: ShapeType,
  patch: Partial<CanvasShape>,
  parentId: string | undefined,
  affectedIds: Set<string>
): string | null {
  const shape = createDefaultShape(type, patch.x ?? 0, patch.y ?? 0)
  Object.assign(shape, patch)
  useCanvasShapeStore.getState().addShape(shape, parentId)
  affectedIds.add(shape.id)
  return shape.id
}

function tokenColor(foundation: TemplateFoundation, token: string): string {
  const found = useDesignSystemStore.getState().getToken(tokenName(foundation, token))
  return found?.kind === 'color' ? found.value : '#FFFFFF'
}

function fontStack(template: DesignSystemTemplateKind | undefined, tone: DesignSystemTemplateTone | undefined): TemplateFoundation['fonts'] {
  if (template === 'game' || tone === 'playful') {
    return {
      headline: 'Montserrat, Inter, system-ui, sans-serif',
      body: 'Plus Jakarta Sans, Inter, system-ui, sans-serif',
      label: 'JetBrains Mono, ui-monospace, monospace'
    }
  }
  if (tone === 'editorial' || template === 'portfolio') {
    return {
      headline: 'Fraunces, Georgia, serif',
      body: 'Inter, system-ui, sans-serif',
      label: 'JetBrains Mono, ui-monospace, monospace'
    }
  }
  return {
    headline: 'Inter, system-ui, sans-serif',
    body: 'Plus Jakarta Sans, Inter, system-ui, sans-serif',
    label: 'JetBrains Mono, ui-monospace, monospace'
  }
}

function iconGlyph(icon: string): string {
  switch (icon) {
    case 'home':
      return 'H'
    case 'magnifier':
      return 'Q'
    case 'user':
      return 'U'
    case 'spark':
      return '*'
    case 'shapes':
      return 'A'
    case 'tag':
      return 'T'
    case 'trash':
      return 'X'
    case 'edit':
      return 'E'
    default:
      return '.'
  }
}

function cleanName(value: string | undefined): string {
  return value?.trim().slice(0, 80) ?? ''
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeHex(value: string | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase()
  const short = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase()
  return null
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex) ?? DEFAULT_SEED
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const t = Math.max(0, Math.min(1, amount))
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t)
}

function rotateHue(hex: string, degrees: number): string {
  const { r, g, b } = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  return hslToHex((h + degrees) % 360, Math.min(0.92, s + 0.08), Math.max(0.28, Math.min(0.68, l)))
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (h < 60) [rp, gp, bp] = [c, x, 0]
  else if (h < 120) [rp, gp, bp] = [x, c, 0]
  else if (h < 180) [rp, gp, bp] = [0, c, x]
  else if (h < 240) [rp, gp, bp] = [0, x, c]
  else if (h < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return rgbToHex((rp + m) * 255, (gp + m) * 255, (bp + m) * 255)
}
