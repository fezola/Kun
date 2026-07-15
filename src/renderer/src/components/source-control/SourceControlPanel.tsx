import type { GitFileStatus } from '@shared/git-source-control'
import {
  GitBranch,
  GitCommitHorizontal,
  Check,
  Minus,
  Plus,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileMinus,
  AlertCircle
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  workspaceRoot?: string
  className?: string
  onCollapse?: () => void
}

function statusIcon(status: string): ReactElement {
  switch (status) {
    case 'A': return <FilePlus className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={1.8} />
    case 'D': return <FileMinus className="h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={1.8} />
    case 'M': return <FileEdit className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.8} />
    case 'R': return <FileEdit className="h-3.5 w-3.5 shrink-0 text-purple-500" strokeWidth={1.8} />
    case '?': return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
    default: return <FileEdit className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
  }
}

function statusLabel(index: string, worktree: string): string {
  if (index === '?' && worktree === '?') return 'U'
  if (index === ' ') return worktree
  return index
}

export function SourceControlPanel({ workspaceRoot, className }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [branch, setBranch] = useState('')
  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [unstagedExpanded, setUnstagedExpanded] = useState(true)
  const commitInputRef = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(async () => {
    if (!workspaceRoot) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.kunGui.getGitStatus(workspaceRoot)
      if (result.ok) {
        setBranch(result.branch)
        setFiles(result.files)
        setAhead(result.ahead)
        setBehind(result.behind)
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => { void refresh() }, [refresh])

  const staged = useMemo(() => files.filter((f) => f.indexStatus !== ' ' && f.indexStatus !== '?'), [files])
  const unstaged = useMemo(
    () => files.filter((f) => f.worktreeStatus !== ' ' && f.worktreeStatus !== '?'),
    [files]
  )
  const untracked = useMemo(() => files.filter((f) => f.indexStatus === '?' && f.worktreeStatus === '?'), [files])

  const stageFile = useCallback(async (path: string) => {
    if (!workspaceRoot) return
    await window.kunGui.stageGitFile({ workspaceRoot, path })
    void refresh()
  }, [workspaceRoot, refresh])

  const unstageFile = useCallback(async (path: string) => {
    if (!workspaceRoot) return
    await window.kunGui.unstageGitFile({ workspaceRoot, path })
    void refresh()
  }, [workspaceRoot, refresh])

  const commit = useCallback(async () => {
    if (!workspaceRoot || !commitMessage.trim()) return
    setCommitting(true)
    try {
      await window.kunGui.commitGitFiles({ workspaceRoot, message: commitMessage.trim() })
      setCommitMessage('')
      void refresh()
    } catch {
      // commit error shown via refresh
    } finally {
      setCommitting(false)
    }
  }, [workspaceRoot, commitMessage, refresh])

  const handleCommitKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void commit()
    }
  }, [commit])

  if (!workspaceRoot) {
    return (
      <div className={`flex flex-1 items-center justify-center p-6 text-center text-[12px] text-ds-muted ${className ?? ''}`}>
        {t('noWorkspaceSelected')}
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className ?? ''}`}>
      <div className="flex items-center gap-2 border-b border-ds-border-muted/50 px-3 py-2">
        <GitBranch className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
        <span className="min-w-0 truncate text-[12px] font-medium text-ds-ink">{branch || '—'}</span>
        {ahead > 0 ? <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">{ahead}↑</span> : null}
        {behind > 0 ? <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">{behind}↓</span> : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ds-code-sidebar-icon-button"
          title={t('refresh') ?? 'Refresh'}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
        </button>
      </div>

      {error ? (
        <div className="px-3 py-2 text-[11px] text-red-600 dark:text-red-400">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {staged.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setStagedExpanded(!stagedExpanded)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ds-muted hover:bg-ds-hover"
            >
              {stagedExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>Staged Changes</span>
              <span className="ml-auto text-[10px] text-ds-faint">{staged.length}</span>
            </button>
            {stagedExpanded ? staged.map((f) => (
              <div key={f.path} className="group flex items-center gap-2 px-3 py-1 text-[12px] text-ds-ink hover:bg-ds-hover">
                {statusIcon(f.indexStatus)}
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                <span className="shrink-0 text-[10px] text-ds-faint">{statusLabel(f.indexStatus, f.worktreeStatus)}</span>
                <button
                  type="button"
                  onClick={() => void unstageFile(f.path)}
                  className="ds-code-sidebar-icon-button ml-1 opacity-0 group-hover:opacity-100"
                  title="Unstage"
                >
                  <Minus className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            )) : null}
          </div>
        ) : null}

        {unstaged.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setUnstagedExpanded(!unstagedExpanded)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ds-muted hover:bg-ds-hover"
            >
              {unstagedExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>Changes</span>
              <span className="ml-auto text-[10px] text-ds-faint">{unstaged.length}</span>
            </button>
            {unstagedExpanded ? unstaged.map((f) => (
              <div key={f.path} className="group flex items-center gap-2 px-3 py-1 text-[12px] text-ds-ink hover:bg-ds-hover">
                {statusIcon(f.worktreeStatus)}
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                <span className="shrink-0 text-[10px] text-ds-faint">{statusLabel(f.indexStatus, f.worktreeStatus)}</span>
                <button
                  type="button"
                  onClick={() => void stageFile(f.path)}
                  className="ds-code-sidebar-icon-button ml-1 opacity-0 group-hover:opacity-100"
                  title="Stage"
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            )) : null}
          </div>
        ) : null}

        {untracked.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setUnstagedExpanded(!unstagedExpanded)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ds-muted hover:bg-ds-hover"
            >
              {unstagedExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>Untracked Files</span>
              <span className="ml-auto text-[10px] text-ds-faint">{untracked.length}</span>
            </button>
            {unstagedExpanded ? untracked.map((f) => (
              <div key={f.path} className="group flex items-center gap-2 px-3 py-1 text-[12px] text-ds-ink hover:bg-ds-hover">
                {statusIcon('?')}
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                <button
                  type="button"
                  onClick={() => void stageFile(f.path)}
                  className="ds-code-sidebar-icon-button ml-1 opacity-0 group-hover:opacity-100"
                  title="Stage"
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            )) : null}
          </div>
        ) : null}

        {!loading && files.length === 0 && !error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12px] text-ds-muted">
            <Check className="h-5 w-5 text-emerald-500" strokeWidth={1.8} />
            <span>No changes</span>
          </div>
        ) : null}
      </div>

      {staged.length > 0 ? (
        <div className="border-t border-ds-border-muted/50 px-3 py-2">
          <textarea
            ref={commitInputRef}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleCommitKeyDown}
            placeholder="Commit message..."
            rows={2}
            className="w-full resize-none rounded-md border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void commit()}
            disabled={committing || !commitMessage.trim()}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {committing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <GitCommitHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            Commit ({staged.length} file{staged.length !== 1 ? 's' : ''})
          </button>
          <div className="mt-1 text-center text-[10px] text-ds-faint">Ctrl+Enter to commit</div>
        </div>
      ) : null}
    </div>
  )
}
