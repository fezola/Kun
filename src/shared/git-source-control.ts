export type GitFileStatus = {
  path: string
  indexStatus: string
  worktreeStatus: string
}

export type GitStatusResult =
  | {
      ok: true
      branch: string
      files: GitFileStatus[]
      ahead: number
      behind: number
    }
  | { ok: false; reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'; message: string }

export type GitDiffResult =
  | { ok: true; diff: string }
  | { ok: false; message: string }

export type GitCommitResult =
  | { ok: true; commitHash: string }
  | { ok: false; message: string }
