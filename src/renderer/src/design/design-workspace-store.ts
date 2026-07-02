import { create } from 'zustand'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  artifactDesignMdPath,
  artifactDesignMdPathOf,
  artifactDirPath,
  deleteArtifactDir,
  persistArtifactMeta
} from './design-artifact-persistence'
import { deleteDocumentDir, flushDocumentsIndex, persistDocumentsIndex } from './design-document-persistence'
import { defaultPreviewNodeSizeForDesignTarget, hashDesignSystem, normalizeDesignTarget } from './design-context'
import { createDesignArtifactId, createDesignDocumentId, defaultDesignArtifactNode } from './design-types'
import type { DesignArtifact, DesignDocument } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import {
  AI_RAIL_COLLAPSED_KEY,
  ASSISTANT_MODEL_KEY,
  ASSISTANT_PROVIDER_KEY,
  CANVAS_ASSISTANT_OPEN_KEY,
  CANVAS_INSPECTOR_PINNED_KEY,
  CANVAS_VIEW_KEY,
  DESIGN_TARGET_KEY,
  MULTI_PAGE_MODE_KEY,
  VIEWPORT_KEY,
  applyToActiveDoc,
  builtinDesignWorkspaceRoot,
  defaultDocumentTitle,
  projectActiveDoc,
  readPersistedAiRailCollapsed,
  readPersistedAssistantModel,
  readPersistedAssistantProvider,
  readPersistedCanvasAssistantOpen,
  readPersistedCanvasInspectorPinned,
  readPersistedCanvasView,
  readPersistedDesignTarget,
  readPersistedMultiPageMode,
  readPersistedViewport,
  rehydrateDesignWorkspaceArtifacts,
  removedArtifactIds,
  removedDocumentIds
} from './design-workspace-store/helpers'

export const useDesignWorkspaceStore = create<DesignWorkspaceState>((set, get) => {
  const persistIndex = (): void => {
    const s = get()
    persistDocumentsIndex(s.workspaceRoot, s.documents, s.activeDocumentId)
  }

  // Structural deletes must hit disk immediately — a debounced write can be lost
  // to a reload before it flushes, resurrecting the just-deleted 设计稿/画布.
  const persistIndexNow = (): void => {
    const s = get()
    void flushDocumentsIndex(s.workspaceRoot, s.documents, s.activeDocumentId)
  }

  return {
    workspaceRoot: '',
    documents: [],
    activeDocumentId: null,
    artifacts: [],
    activeArtifactId: null,
    canvasView: readPersistedCanvasView(),
    viewport: readPersistedViewport(),
    devPreviewUrl: '',
    assistantModel: readPersistedAssistantModel(),
    assistantProviderId: readPersistedAssistantProvider(),
    designContext: { designTarget: readPersistedDesignTarget() },
    canvasBackground: 'light',
    liveRefresh: true,
    deviceFrame: true,
    generationPrompt: '',
    reasoningEffort: '',
    implementStackHint: '',
    injectIntoCode: true,
    publishDesignSystem: true,
    settingsLoaded: false,
    fileError: null,
    designSystemHash: '',
    implementOpen: false,
    implementTitle: '',
    aiRailCollapsed: readPersistedAiRailCollapsed(),
    canvasAssistantOpen: readPersistedCanvasAssistantOpen(),
    canvasInspectorPinned: readPersistedCanvasInspectorPinned(),
    designIntentMode: 'generate',
    multiPageMode: readPersistedMultiPageMode(),
    pagesRun: null,
    parallelPageStates: {},

    setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),

    setCanvasView: (view) => {
      writeBrowserStorageItem(CANVAS_VIEW_KEY, view)
      set({ canvasView: view })
    },

    setViewport: (viewport) => {
      writeBrowserStorageItem(VIEWPORT_KEY, viewport)
      set({ viewport })
    },

    setDevPreviewUrl: (url) => set({ devPreviewUrl: url }),

    setCanvasBackground: (background) => set({ canvasBackground: background }),

    setActiveArtifact: (artifactId) => {
      set((state) => {
        const idx = state.documents.findIndex((d) => d.id === state.activeDocumentId)
        if (idx === -1) return { activeArtifactId: artifactId, fileError: null }
        const doc = state.documents[idx]
        if (doc.activeArtifactId === artifactId) return { fileError: null }
        const documents = state.documents.map((d, i) => (i === idx ? { ...d, activeArtifactId: artifactId } : d))
        return { documents, activeArtifactId: artifactId, fileError: null }
      })
      persistIndex()
    },

    createDocument: (title) => {
      const id = createDesignDocumentId()
      const createdAt = new Date().toISOString()
      set((state) => {
        const order = state.documents.reduce((max, d) => Math.max(max, d.order), -1) + 1
        const doc: DesignDocument = {
          id,
          title: (title ?? '').trim() || defaultDocumentTitle(),
          createdAt,
          updatedAt: createdAt,
          order,
          artifacts: [],
          activeArtifactId: null
        }
        const documents = [...state.documents, doc]
        return { documents, activeDocumentId: id, ...projectActiveDoc(documents, id), fileError: null }
      })
      persistIndex()
      return id
    },

    renameDocument: (documentId, title) => {
      const trimmed = title.trim()
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === documentId ? { ...d, title: trimmed || d.title, updatedAt: new Date().toISOString() } : d
        )
      }))
      persistIndex()
    },

    removeDocument: (documentId) => {
      removedDocumentIds.add(documentId)
      const workspaceRoot = get().workspaceRoot
      const doc = get().documents.find((d) => d.id === documentId)
      if (doc) {
        for (const artifact of doc.artifacts) {
          removedArtifactIds.add(artifact.id)
          deleteArtifactDir(workspaceRoot, artifact.relativePath)
        }
      }
      deleteDocumentDir(workspaceRoot, documentId)
      set((state) => {
        const documents = state.documents.filter((d) => d.id !== documentId)
        const activeDocumentId =
          state.activeDocumentId === documentId ? documents[0]?.id ?? null : state.activeDocumentId
        return { documents, activeDocumentId, ...projectActiveDoc(documents, activeDocumentId), fileError: null }
      })
      persistIndexNow()
    },

    switchActiveDocument: (documentId) => {
      set((state) => {
        if (!state.documents.some((d) => d.id === documentId)) return {}
        return { activeDocumentId: documentId, ...projectActiveDoc(state.documents, documentId), fileError: null }
      })
      persistIndex()
    },

    ensureActiveDocument: () => {
      const state = get()
      if (state.activeDocumentId && state.documents.some((d) => d.id === state.activeDocumentId)) {
        return state.activeDocumentId
      }
      if (state.documents.length > 0) {
        const id = state.documents[0].id
        set({ activeDocumentId: id, ...projectActiveDoc(state.documents, id) })
        persistIndex()
        return id
      }
      return get().createDocument()
    },

    upsertArtifact: (artifact) => {
      get().ensureActiveDocument()
      set((state) =>
        applyToActiveDoc(
          state,
          (artifacts) => {
            const withDefaults =
              artifact.kind === 'html'
                ? { ...artifact, designMdPath: artifact.designMdPath ?? artifactDesignMdPathOf(artifact.relativePath) }
                : artifact
            const defaultNode =
              withDefaults.kind === 'html'
                ? {
                    ...defaultDesignArtifactNode(artifacts.length),
                    ...defaultPreviewNodeSizeForDesignTarget(state.designContext.designTarget)
                  }
                : defaultDesignArtifactNode(artifacts.length)
            const nextArtifact = withDefaults.node
              ? withDefaults
              : { ...withDefaults, node: defaultNode }
            return artifacts.some((item) => item.id === artifact.id)
              ? artifacts.map((item) => (item.id === artifact.id ? nextArtifact : item))
              : [nextArtifact, ...artifacts]
          },
          artifact.id
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifact.id)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    addArtifactVersion: (artifactId, version) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) =>
            item.id === artifactId
              ? {
                  ...item,
                  relativePath: version.relativePath,
                  updatedAt: version.createdAt,
                  versions: [version, ...item.versions],
                  ...(item.kind === 'html'
                    ? {
                        designMdPath: item.designMdPath ?? artifactDesignMdPathOf(version.relativePath),
                        previewStatus: 'pending' as const
                      }
                    : {})
                }
              : item
          )
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    markImplemented: (artifactId, threadId, designSystemHash) => {
      set((state) => ({
        ...(designSystemHash ? { designSystemHash } : {}),
        ...applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) =>
            item.id === artifactId
              ? {
                  ...item,
                  implementedAt: new Date().toISOString(),
                  implementedThreadId: threadId,
                  ...(designSystemHash ? { implementedDesignSystemHash: designSystemHash } : {})
                }
              : item
          )
        )
      }))
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    removeArtifact: (artifactId) => {
      removedArtifactIds.add(artifactId)
      const target = get().artifacts.find((item) => item.id === artifactId)
      if (target) deleteArtifactDir(get().workspaceRoot, target.relativePath)
      set((state) => {
        const idx = state.documents.findIndex((d) => d.id === state.activeDocumentId)
        if (idx === -1) return {}
        const doc = state.documents[idx]
        const artifacts = doc.artifacts.filter((item) => item.id !== artifactId)
        const activeArtifactId =
          doc.activeArtifactId === artifactId ? artifacts[0]?.id ?? null : doc.activeArtifactId
        const nextDoc: DesignDocument = { ...doc, artifacts, activeArtifactId, updatedAt: new Date().toISOString() }
        const documents = state.documents.map((d, i) => (i === idx ? nextDoc : d))
        return { documents, artifacts, activeArtifactId }
      })
      persistIndexNow()
    },

    renameArtifact: (artifactId, title) => {
      const trimmed = title.trim()
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => (item.id === artifactId ? { ...item, title: trimmed || item.title } : item))
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    setVersionSummary: (artifactId, versionId, summary) => {
      const trimmed = summary.trim()
      if (!trimmed) return
      let changedAny = false
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => {
            if (item.id !== artifactId) return item
            let changed = false
            const versions = item.versions.map((version) => {
              if (version.id !== versionId || version.summary === trimmed) return version
              changed = true
              return { ...version, summary: trimmed }
            })
            if (changed) changedAny = true
            return changed ? { ...item, versions } : item
          })
        )
      )
      if (!changedAny) return
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    setArtifactPreviewStatus: (artifactId, status) => {
      let changedAny = false
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => {
            if (item.id !== artifactId || item.kind !== 'html' || item.previewStatus === status) {
              return item
            }
            changedAny = true
            return { ...item, previewStatus: status }
          })
        )
      )
      if (!changedAny) return
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
      persistIndex()
    },

    setDirectionStatus: (directionId, status) => {
      const id = directionId.trim()
      if (!id) return
      const changedIds = new Set<string>()
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item, index) => {
            if (item.direction?.id !== id) return item
            const directionChanged = (item.direction.status ?? 'active') !== status
            const shouldFavorite = status === 'accepted' && item.node?.favorite !== true
            if (!directionChanged && !shouldFavorite) return item
            changedIds.add(item.id)
            const node = shouldFavorite
              ? { ...(item.node ?? defaultDesignArtifactNode(index)), favorite: true }
              : item.node
            return {
              ...item,
              direction: { ...item.direction, status },
              ...(node ? { node } : {})
            }
          })
        )
      )
      if (changedIds.size === 0) return
      const state = get()
      for (const item of state.artifacts) {
        if (changedIds.has(item.id)) persistArtifactMeta(state.workspaceRoot, item)
      }
      persistIndex()
    },

    updateArtifactNode: (artifactId, patch) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item, index) => {
            if (item.id !== artifactId) return item
            const current = item.node ?? defaultDesignArtifactNode(index)
            return {
              ...item,
              node: {
                ...current,
                ...patch,
                width: Math.max(240, patch.width ?? current.width),
                height: Math.max(180, patch.height ?? current.height)
              }
            }
          })
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
    },

    duplicateArtifact: async (artifactId) => {
      const state = get()
      const source = state.artifacts.find((item) => item.id === artifactId)
      const workspaceRoot = state.workspaceRoot
      if (
        !source ||
        source.kind !== 'html' ||
        !workspaceRoot ||
        typeof window.kunGui?.readWorkspaceFile !== 'function' ||
        typeof window.kunGui?.writeWorkspaceFile !== 'function'
      ) {
        return
      }
      const read = await window.kunGui
        .readWorkspaceFile({ path: source.relativePath, workspaceRoot })
        .catch(() => null)
      if (!read || !read.ok) return
      const docId = get().ensureActiveDocument()
      const createdAt = new Date().toISOString()
      const copyId = createDesignArtifactId()
      const relativePath = `${artifactDirPath(docId, copyId)}/v1.html`
      const designMdPath = artifactDesignMdPath(docId, copyId)
      const write = await window.kunGui
        .writeWorkspaceFile({ path: relativePath, workspaceRoot, content: read.content })
        .catch(() => null)
      if (!write || !write.ok) return
      const sourceNode =
        source.node ?? defaultDesignArtifactNode(state.artifacts.findIndex((item) => item.id === source.id))
      get().upsertArtifact({
        id: copyId,
        kind: 'html',
        title: `${source.title} copy`,
        relativePath,
        createdAt,
        updatedAt: createdAt,
        versions: [{ id: `${copyId}-v1`, relativePath, createdAt, summary: source.versions[0]?.summary ?? '' }],
        designMdPath,
        previewStatus: 'ready',
        node: { ...sourceNode, x: sourceNode.x + 44, y: sourceNode.y + 44 }
      })
    },

    selectArtifactVersion: (artifactId, versionId) => {
      set((state) =>
        applyToActiveDoc(state, (artifacts) =>
          artifacts.map((item) => {
            if (item.id !== artifactId) return item
            const version = item.versions.find((candidate) => candidate.id === versionId)
            if (!version) return item
            return { ...item, relativePath: version.relativePath, updatedAt: version.createdAt }
          })
        )
      )
      const updated = get().artifacts.find((item) => item.id === artifactId)
      if (updated) persistArtifactMeta(get().workspaceRoot, updated)
    },

    setDesignIntentMode: (mode) => set({ designIntentMode: mode }),

    setDesignTarget: (target) => {
      const normalized = normalizeDesignTarget(target)
      writeBrowserStorageItem(DESIGN_TARGET_KEY, normalized)
      set((state) => ({ designContext: { ...state.designContext, designTarget: normalized } }))
    },

    setMultiPageMode: (on) => {
      writeBrowserStorageItem(MULTI_PAGE_MODE_KEY, on ? '1' : '0')
      set({ multiPageMode: on })
    },

    setPagesRun: (state) => set({ pagesRun: state }),

    setParallelPageStates: (states) =>
      set({
        parallelPageStates: Object.fromEntries(
          states.map((state) => [state.artifactId, state])
        )
      }),

    updateParallelPageState: (artifactId, patch) => {
      const id = artifactId.trim()
      if (!id) return
      set((state) => ({
        parallelPageStates: {
          ...state.parallelPageStates,
          [id]: {
            ...state.parallelPageStates[id],
            ...patch,
            artifactId: id,
            status: patch.status ?? state.parallelPageStates[id]?.status ?? 'queued',
            updatedAt: patch.updatedAt ?? new Date().toISOString()
          }
        }
      }))
    },

    clearParallelPageStates: () => set({ parallelPageStates: {} }),

    setFileError: (error) => set({ fileError: error }),

    openImplementPanel: (title) => set({ implementOpen: true, implementTitle: title }),

    closeImplementPanel: () => set({ implementOpen: false }),

    prepareHtmlTurn: (brief, options = {}) => {
      const text = brief.trim()
      const docId = get().ensureActiveDocument()
      const state = get()
      const active = state.artifacts.find((item) => item.id === state.activeArtifactId) ?? null
      const target = options.artifactId
        ? state.artifacts.find((item) => item.id === options.artifactId) ?? null
        : active
      // Only HTML artifacts can be iterated; a canvas/other active artifact starts a fresh draft.
      const activeHtml = !options.forceNew && target?.kind === 'html' ? target : null
      const createdAt = new Date().toISOString()

      if (activeHtml) {
        const versionN = activeHtml.versions.length + 1
        const dir = activeHtml.relativePath.slice(0, activeHtml.relativePath.lastIndexOf('/'))
        const relativePath = `${dir}/v${versionN}.html`
        const designMdPath = activeHtml.designMdPath ?? `${dir}/DESIGN.md`
        get().addArtifactVersion(activeHtml.id, {
          id: `${activeHtml.id}-v${versionN}`,
          relativePath,
          createdAt,
          summary: text
        })
        if (options.activate !== false) get().setActiveArtifact(activeHtml.id)
        return { artifactId: activeHtml.id, relativePath, basePath: activeHtml.relativePath, designMdPath }
      }

      const artifactId = createDesignArtifactId()
      const relativePath = `${artifactDirPath(docId, artifactId)}/v1.html`
      const designMdPath = artifactDesignMdPath(docId, artifactId)
      const title = text.length > 48 ? `${text.slice(0, 48)}…` : text || 'Untitled design'
      const nodeSize = defaultPreviewNodeSizeForDesignTarget(state.designContext.designTarget)
      get().upsertArtifact({
        id: artifactId,
        kind: 'html',
        title,
        relativePath,
        createdAt,
        updatedAt: createdAt,
        versions: [{ id: `${artifactId}-v1`, relativePath, createdAt, summary: text }],
        designMdPath,
        previewStatus: 'pending',
        node: { ...defaultDesignArtifactNode(state.artifacts.length), ...nodeSize }
      })
      if (options.activate === false) set({ activeArtifactId: state.activeArtifactId })
      return { artifactId, relativePath, designMdPath }
    },

    setAiRailCollapsed: (collapsed) => {
      writeBrowserStorageItem(AI_RAIL_COLLAPSED_KEY, collapsed ? '1' : '0')
      writeBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY, collapsed ? '0' : '1')
      set({ aiRailCollapsed: collapsed, canvasAssistantOpen: !collapsed })
    },

    setCanvasAssistantOpen: (open) => {
      writeBrowserStorageItem(CANVAS_ASSISTANT_OPEN_KEY, open ? '1' : '0')
      writeBrowserStorageItem(AI_RAIL_COLLAPSED_KEY, open ? '0' : '1')
      set({ canvasAssistantOpen: open, aiRailCollapsed: !open })
    },

    toggleCanvasAssistantOpen: () => {
      get().setCanvasAssistantOpen(!get().canvasAssistantOpen)
    },

    setCanvasInspectorPinned: (pinned) => {
      writeBrowserStorageItem(CANVAS_INSPECTOR_PINNED_KEY, pinned ? '1' : '0')
      set({ canvasInspectorPinned: pinned })
    },

    setAssistantModel: (model, providerId) => {
      const normalized = model.trim()
      const normalizedProvider = (providerId ?? '').trim()
      writeBrowserStorageItem(ASSISTANT_MODEL_KEY, normalized)
      writeBrowserStorageItem(ASSISTANT_PROVIDER_KEY, normalizedProvider)
      set({ assistantModel: normalized, assistantProviderId: normalizedProvider })
    },

    updateDesignContext: (patch) => {
      const nextPatch = { ...patch }
      if (nextPatch.designTarget) {
        nextPatch.designTarget = normalizeDesignTarget(nextPatch.designTarget)
        writeBrowserStorageItem(DESIGN_TARGET_KEY, nextPatch.designTarget)
      }
      set((state) => ({ designContext: { ...state.designContext, ...nextPatch } }))
    },

    loadDesignSettings: async () => {
      set({ settingsLoaded: false })
      try {
        try {
          const settings = await rendererRuntimeClient.getSettings()
          const design = settings.design
          const hasStoredViewport = readBrowserStorageItem(VIEWPORT_KEY) !== null
          const hasStoredView = readBrowserStorageItem(CANVAS_VIEW_KEY) !== null
          set((state) => ({
            workspaceRoot: state.workspaceRoot || design.defaultWorkspaceRoot || builtinDesignWorkspaceRoot() || '',
            assistantModel: state.assistantModel || design.model,
            assistantProviderId: state.assistantProviderId || design.providerId,
            canvasBackground: design.canvasBackground,
            liveRefresh: design.liveRefresh,
            deviceFrame: design.deviceFrame,
            generationPrompt: design.generationPrompt,
            reasoningEffort: design.reasoningEffort,
            implementStackHint: design.implementStackHint,
            injectIntoCode: design.injectIntoCode,
            publishDesignSystem: design.publishDesignSystem,
            viewport: hasStoredViewport ? state.viewport : design.defaultViewport,
            canvasView: hasStoredView ? state.canvasView : design.defaultCanvasView,
            designContext: {
              ...state.designContext,
              designTarget: state.designContext.designTarget ?? readPersistedDesignTarget(),
              designType: state.designContext.designType ?? (design.designType || undefined),
              designGuidelines: state.designContext.designGuidelines || design.designGuidelines || undefined,
              radius: state.designContext.radius ?? (design.radius || undefined),
              density: state.designContext.density ?? (design.density || undefined),
              fontStyle: state.designContext.fontStyle ?? (design.fontStyle || undefined),
              brandColor: state.designContext.brandColor || design.brandColor || undefined,
              tone:
                state.designContext.tone && state.designContext.tone.length > 0
                  ? state.designContext.tone
                  : design.tone.length > 0
                    ? design.tone
                    : undefined,
              designSystemPreset:
                state.designContext.designSystemPreset ??
                (design.designSystemPreset === 'none' ? undefined : design.designSystemPreset)
            }
          }))
        } catch {
          // Keep local/default state and still let rehydration/fallback below settle the workspace.
        }
        await get().rehydrateArtifacts()
        await get().refreshDesignSystemHash()
        // Always land on an active 设计稿 so the canvas has somewhere to render.
        if (get().documents.length === 0) get().createDocument()
      } finally {
        set({ settingsLoaded: true })
      }
    },

    rehydrateArtifacts: () => rehydrateDesignWorkspaceArtifacts({ get, set, persistIndex }),

    refreshDesignSystemHash: async () => {
      const { workspaceRoot } = get()
      if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') {
        set({ designSystemHash: '' })
        return
      }
      const res = await window.kunGui
        .readWorkspaceFile({ path: '.kun-design/DESIGN_SYSTEM.md', workspaceRoot })
        .catch(() => null)
      set({ designSystemHash: res && res.ok ? hashDesignSystem(res.content) : '' })
    },

    resetWorkspace: () =>
      set({
        documents: [],
        activeDocumentId: null,
        artifacts: [],
        activeArtifactId: null,
        fileError: null,
        designSystemHash: '',
        implementOpen: false,
        pagesRun: null,
        parallelPageStates: {}
      })
  }
})
