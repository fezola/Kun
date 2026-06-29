import { useEffect, useState } from 'react'
import { useCanvasWorkspaceRoot } from './canvas-workspace-context'

const DIRECT_URL_RE = /^(data:|https?:|blob:)/i
// Generated image filenames are content-stamped and immutable, so a path→dataUrl
// map never goes stale and can live for the whole session.
const cache = new Map<string, string>()
const failed = new Set<string>()

function cacheKey(workspaceRoot: string, path: string): string {
  return `${workspaceRoot}::${path}`
}

export function isDirectImageUrl(url: string): boolean {
  return DIRECT_URL_RE.test(url)
}

async function resolveWorkspaceImage(
  workspaceRoot: string,
  path: string,
  key: string
): Promise<string | null> {
  const hit = cache.get(key)
  if (hit) return hit
  if (failed.has(key)) return null
  if (typeof window.kunGui?.readWorkspaceImage !== 'function') return null
  try {
    const result = await window.kunGui.readWorkspaceImage({
      path,
      ...(workspaceRoot ? { workspaceRoot } : {})
    })
    if (result.ok) {
      cache.set(key, result.dataUrl)
      return result.dataUrl
    }
  } catch {
    // fall through to failure
  }
  failed.add(key)
  return null
}

/**
 * Context-free resolver: turn a shape `imageUrl` into a renderable URL without
 * the `CanvasWorkspaceContext` (used by surfaces mounted outside the canvas,
 * e.g. the full-screen annotation editor). Direct URLs pass through; a
 * workspace-relative path is loaded via IPC and cached. Returns null on failure.
 */
export async function loadWorkspaceImageDataUrl(
  workspaceRoot: string,
  imageUrl: string | undefined
): Promise<string | null> {
  if (!imageUrl) return null
  if (isDirectImageUrl(imageUrl)) return imageUrl
  return resolveWorkspaceImage(workspaceRoot, imageUrl, cacheKey(workspaceRoot, imageUrl))
}

/**
 * Resolve a shape's `imageUrl` into something an SVG `<image>` can render.
 * Direct URLs (`data:`/`http(s):`/`blob:`) pass through untouched; a
 * workspace-relative path (e.g. `.deepseekgui-images/img-*.png`) is loaded once
 * via `readWorkspaceImage` and cached. Returns null while loading or on failure
 * so the caller can show its placeholder.
 */
export function useWorkspaceImageSrc(imageUrl: string | undefined): string | null {
  const workspaceRoot = useCanvasWorkspaceRoot()
  const direct = imageUrl && isDirectImageUrl(imageUrl) ? imageUrl : null
  const [resolved, setResolved] = useState<string | null>(() =>
    imageUrl && !direct ? cache.get(cacheKey(workspaceRoot, imageUrl)) ?? null : null
  )

  useEffect(() => {
    if (!imageUrl || direct) {
      setResolved(null)
      return
    }
    const key = cacheKey(workspaceRoot, imageUrl)
    const hit = cache.get(key)
    if (hit) {
      setResolved(hit)
      return
    }
    let active = true
    void resolveWorkspaceImage(workspaceRoot, imageUrl, key).then((url) => {
      if (active) setResolved(url)
    })
    return () => {
      active = false
    }
  }, [workspaceRoot, imageUrl, direct])

  return direct ?? resolved
}
