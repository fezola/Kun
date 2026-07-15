import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronDown, Folder, FolderPlus, GitFork, Loader2, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import {
  isClawWorkspacePath,
  isConversationWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../../lib/workspace-path'
import { resolveProjectWorkspacePath } from '../../lib/worktree-project-path'
import { readThreadWorktreeRegistry, type ThreadWorktreeRecord } from '../../lib/thread-worktree-registry'

type Props = {
  /** The directory new conversations will target (active thread's workspace or the global root). */
  currentWorkspaceRoot: string
}

type WorkspaceOption = {
  root: string
  label: string
  /** Parent folder, shown muted to disambiguate same-named projects. */
  context: string
}
type WorkspaceProjectPickerWorktrees = Record<string, Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'>>

// Parent folder name, mirrors the sidebar's secondary project label. Hidden when
// it would just repeat the folder name.
function workspaceContext(root: string, label: string): string {
  const parts = root.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  return !parent || parent.toLowerCase() === label.toLowerCase() ? '' : parent
}

function workspaceProjectRootForPicker(
  workspacePath: string,
  threadWorktrees: WorkspaceProjectPickerWorktrees = {},
  candidateProjectPaths: readonly string[] = []
): string {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  const key = workspaceRootIdentityKey(normalized)
  if (!key) return ''
  for (const record of Object.values(threadWorktrees)) {
    const worktreePath = normalizeWorkspaceRoot(record.worktreePath)
    if (workspaceRootIdentityKey(worktreePath) === key) {
      return normalizeWorkspaceRoot(record.projectPath) || normalized
    }
  }
  return resolveProjectWorkspacePath(normalized, {
    threadWorktrees,
    candidateProjectPaths
  })
}

export function buildWorkspaceProjectPickerOptions(options: {
  currentWorkspaceRoot: string
  workspaceRoots: readonly string[]
  threadWorktrees?: WorkspaceProjectPickerWorktrees
  conversationWorkspaceRoot?: string
}): { currentRoot: string, options: WorkspaceOption[] } {
  const threadWorktrees = options.threadWorktrees ?? {}
  const candidateProjectPaths = [
    options.currentWorkspaceRoot,
    ...options.workspaceRoots,
    ...Object.values(threadWorktrees).map((record) => record.projectPath)
  ]
  const currentRoot = workspaceProjectRootForPicker(
    options.currentWorkspaceRoot,
    threadWorktrees,
    candidateProjectPaths
  )
  const seen = new Set<string>()
  const out: WorkspaceOption[] = []
  for (const raw of [currentRoot, ...options.workspaceRoots]) {
    const root = workspaceProjectRootForPicker(raw, threadWorktrees, candidateProjectPaths)
    if (!isWorkspaceProjectPickerRoot(root, options.conversationWorkspaceRoot)) continue
    const key = workspaceRootIdentityKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    const label = workspaceLabelFromPath(root)
    out.push({ root, label, context: workspaceContext(root, label) })
  }
  return {
    currentRoot,
    options: out.sort((a, b) => a.label.localeCompare(b.label))
  }
}

function isWorkspaceProjectPickerRoot(root: string, conversationRoot?: string): boolean {
  const normalized = normalizeWorkspaceRoot(root)
  if (!normalized) return false
  if (isInternalTemporaryWorkspace(normalized)) return false
  if (isInternalDeepSeekGuiWorkspace(normalized)) return false
  if (isClawWorkspacePath(normalized)) return false
  // Exclude conversation workspaces created via "New Conversation"
  if (isConversationWorkspacePath(normalized, conversationRoot)) return false
  return true
}

export function WorkspaceProjectPicker({ currentWorkspaceRoot }: Props): ReactElement {
  const { t } = useTranslation('common')
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const conversationWorkspaceRoot = useChatStore((s) => s.conversationWorkspaceRoot)
  const selectWorkspaceRoot = useChatStore((s) => s.selectWorkspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const runtimeReady = useChatStore((s) => s.runtimeConnection === 'ready')

  const current = normalizeWorkspaceRoot(currentWorkspaceRoot)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cloneInputRef = useRef<HTMLInputElement | null>(null)

  const { currentRoot, options } = useMemo(() => {
    return buildWorkspaceProjectPickerOptions({
      currentWorkspaceRoot: current,
      workspaceRoots: codeWorkspaceRoots,
      threadWorktrees: readThreadWorktreeRegistry().worktrees,
      conversationWorkspaceRoot
    })
  }, [codeWorkspaceRoots, current, conversationWorkspaceRoot])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.root.toLowerCase().includes(q)
    )
  }, [options, query])

  const showSearch = options.length > 5

  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [current])

  useEffect(() => {
    if (!open) return
    if (showSearch) window.setTimeout(() => inputRef.current?.focus(), 0)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, showSearch])

  const label = currentRoot ? workspaceLabelFromPath(currentRoot) : t('selectWorkspace')

  const handleSelect = async (root: string): Promise<void> => {
    if (acting) return
    if (workspaceRootIdentityKey(root) === workspaceRootIdentityKey(currentRoot)) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await selectWorkspaceRoot(root)
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  const handleAdd = async (): Promise<void> => {
    if (acting) return
    setActing(true)
    try {
      // Pick a directory (no thread select), then land on a clean new
      // conversation for it — same end-state as choosing an existing project.
      const picked = await chooseWorkspace({ selectThreadAfter: false })
      if (picked) await selectWorkspaceRoot(picked)
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  const handleClone = async (): Promise<void> => {
    if (cloning || !cloneUrl.trim()) return
    setCloning(true)
    setCloneError('')
    try {
      const result = await window.kunGui.cloneRepository(cloneUrl.trim())
      if (result.canceled || !result.path) {
        setCloneError('Clone failed. Check the URL and try again.')
        return
      }
      await selectWorkspaceRoot(result.path)
      setOpen(false)
      setCloneOpen(false)
      setCloneUrl('')
      setQuery('')
    } catch {
      setCloneError('Clone failed. Make sure git is installed and the URL is valid.')
    } finally {
      setCloning(false)
    }
  }

  return (
    <div ref={wrapRef} className="ds-workspace-project-picker ds-no-drag relative min-w-0">
      <button
        type="button"
        className="flex h-8 max-w-[280px] min-w-0 items-center gap-2 rounded-lg px-2 text-[14px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => setOpen((v) => !v)}
        title={t('workingDirectory')}
        disabled={!runtimeReady}
      >
        <Folder className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{label}</span>
        {acting ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
      </button>

      {open ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(360px,calc(100vw-48px))] overflow-hidden rounded-xl border border-ds-border bg-ds-elevated shadow-[0_24px_70px_rgba(44,55,78,0.18)] backdrop-blur-xl dark:shadow-[0_30px_80px_rgba(0,0,0,0.42)]">
          {showSearch ? (
            <div className="flex items-center gap-2 border-b border-ds-border-muted px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
                placeholder={t('composerWorkspaceSearch')}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </div>
          ) : null}

          <div className="max-h-[320px] overflow-y-auto px-3 py-3">
            <div className="mb-2 px-1 text-[13px] font-medium text-ds-faint">
              {t('sidebarProjects')}
            </div>

            {filtered.map((option) => {
              const isCurrent = workspaceRootIdentityKey(option.root) === workspaceRootIdentityKey(currentRoot)
              return (
                <button
                  key={option.root}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-lg px-1 py-2.5 text-left text-ds-ink transition hover:bg-ds-hover"
                  onClick={() => void handleSelect(option.root)}
                  disabled={acting}
                  title={option.root}
                >
                  <Folder className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{option.label}</span>
                    {option.context ? (
                      <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                        {option.context}
                      </span>
                    ) : null}
                  </span>
                  {isCurrent ? (
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-ds-muted" strokeWidth={2} />
                  ) : null}
                </button>
              )
            })}

            {filtered.length === 0 ? (
              <div className="px-1 py-3 text-[13px] text-ds-faint">
                {options.length === 0 ? t('composerWorkspaceEmpty') : t('composerWorkspaceNoMatch')}
              </div>
            ) : null}
          </div>

          <div className="border-t border-ds-border-muted px-3 py-3">
            {cloneOpen ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={cloneInputRef}
                    value={cloneUrl}
                    onChange={(e) => { setCloneUrl(e.target.value); setCloneError('') }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleClone()
                      if (e.key === 'Escape') { setCloneOpen(false); setCloneUrl(''); setCloneError('') }
                    }}
                    placeholder="https://github.com/user/repo.git"
                    className="flex-1 rounded-lg border border-ds-border bg-ds-surface px-3 py-1.5 text-[13px] text-ds-ink outline-none focus:border-blue-500"
                    autoFocus
                    disabled={cloning}
                  />
                  <button
                    type="button"
                    onClick={() => { setCloneOpen(false); setCloneUrl(''); setCloneError('') }}
                    className="rounded p-1 text-ds-faint hover:text-ds-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {cloneError && (
                  <div className="text-[11px] text-red-500">{cloneError}</div>
                )}
                <button
                  type="button"
                  disabled={cloning || !cloneUrl.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void handleClone()}
                >
                  {cloning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Cloning...</span>
                    </>
                  ) : (
                    <>
                      <GitFork className="h-3.5 w-3.5" />
                      <span>Clone</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={acting}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-[14px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                  onClick={() => void handleAdd()}
                >
                  <FolderPlus className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.9} />
                  <span className="min-w-0 truncate">{t('composerWorkspaceAdd')}</span>
                </button>
                <button
                  type="button"
                  disabled={acting || cloning}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left text-[14px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                  onClick={() => { setCloneOpen(true); setTimeout(() => cloneInputRef.current?.focus(), 0) }}
                >
                  <GitFork className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.9} />
                  <span className="min-w-0 truncate">Clone Repository</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
