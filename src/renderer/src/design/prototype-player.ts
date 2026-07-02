import type { DesignArtifact, DesignPrototypeLink } from './design-types'

export type PrototypePlayerLink = DesignPrototypeLink & {
  targetArtifactId: string
  targetTitle: string
}

const PROTOTYPE_NAV_HASH_PREFIX = 'kun-proto-nav='

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeUrlForCompare(value: string, baseUrl: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed, baseUrl)
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return trimmed
  }
}

export function shouldCapturePrototypeNavigationHref(value: string, baseUrl: string): boolean {
  const raw = value.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('?')) return false
  if (/^(?:javascript|mailto|tel|data):/i.test(raw)) return false
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) return true
  try {
    const url = new URL(raw, baseUrl)
    const base = new URL(baseUrl)
    if (url.protocol === 'file:') return true
    return url.origin === base.origin
  } catch {
    return false
  }
}

export function extractPrototypeNavigationHref(navigationUrl: string): string | null {
  const raw = navigationUrl.trim()
  if (!raw) return null
  const hash = raw.startsWith('#')
    ? raw.slice(1)
    : (() => {
        try {
          return new URL(raw).hash.slice(1)
        } catch {
          return ''
        }
      })()
  if (!hash.startsWith(PROTOTYPE_NAV_HASH_PREFIX)) return null
  return decodeURIComponent(hash.slice(PROTOTYPE_NAV_HASH_PREFIX.length))
}

export function resolvePrototypeNavigationTarget(
  navigationUrl: string,
  currentFileUrl: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const href = extractPrototypeNavigationHref(navigationUrl) ?? navigationUrl
  const normalizedHref = normalizeUrlForCompare(href, currentFileUrl)
  for (const link of links) {
    if (!link.href) continue
    if (href === link.href) return link
    const normalizedLink = normalizeUrlForCompare(link.href, currentFileUrl)
    if (normalizedHref && normalizedLink && normalizedHref === normalizedLink) return link
  }
  return null
}

export function buildPrototypeNavigationCaptureScript(links: readonly PrototypePlayerLink[]): string {
  const hrefs = links.map((link) => link.href).filter((href): href is string => Boolean(href?.trim()))
  return `
(() => {
  const key = '__kunPrototypeNavCaptureInstalled';
  const hrefs = ${JSON.stringify(hrefs)};
  const normalize = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      url.hash = '';
      url.search = '';
      return url.href;
    } catch {
      return String(value || '').trim();
    }
  };
  const allowed = new Set();
  for (const href of hrefs) {
    allowed.add(href);
    allowed.add(normalize(href));
  }
  const shouldCapture = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('?')) return false;
    if (/^(?:javascript|mailto|tel|data):/i.test(raw)) return false;
    if (!/^[a-z][a-z\\d+.-]*:/i.test(raw)) return true;
    try {
      const url = new URL(raw, document.baseURI);
      const base = new URL(document.baseURI);
      if (url.protocol === 'file:') return true;
      return url.origin === base.origin;
    } catch {
      return false;
    }
  };
  window[key] = allowed;
  const navigate = (href, event) => {
    if (!href || String(href).trim().startsWith('#')) return false;
    const raw = String(href).trim();
    if (!allowed.has(raw) && !allowed.has(normalize(raw)) && !shouldCapture(raw)) return false;
    event.preventDefault();
    event.stopPropagation();
    window.location.hash = '${PROTOTYPE_NAV_HASH_PREFIX}' + encodeURIComponent(raw);
    return true;
  };
  if (!window.__kunPrototypeNavListenerInstalled) {
    window.__kunPrototypeNavListenerInstalled = true;
    document.addEventListener('click', (event) => {
      const target = event.target;
      const start = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
      const el = start && start.closest
        ? start.closest('a[href],[data-prototype-href],[data-href],button[data-href]')
        : null;
      if (!el) return;
      const href = el.getAttribute('href') || el.getAttribute('data-prototype-href') || el.getAttribute('data-href');
      navigate(href, event);
    }, true);
  }
  return true;
})()
`
}

export function resolveInitialPrototypeArtifactId(
  artifacts: readonly DesignArtifact[],
  preferredArtifactId?: string | null
): string | null {
  const htmlArtifacts = artifacts.filter((artifact) => artifact.kind === 'html')
  if (htmlArtifacts.length === 0) return null
  if (preferredArtifactId && htmlArtifacts.some((artifact) => artifact.id === preferredArtifactId)) {
    return preferredArtifactId
  }
  return htmlArtifacts.find((artifact) => (artifact.prototypeLinks?.length ?? 0) > 0)?.id ?? htmlArtifacts[0].id
}

export function hasPrototypePlayback(artifacts: readonly DesignArtifact[]): boolean {
  return artifacts.some((artifact) => resolvePrototypeLinks(artifact, artifacts).length > 0)
}

export function resolvePrototypeLinks(
  artifact: DesignArtifact | null | undefined,
  artifacts: readonly DesignArtifact[]
): PrototypePlayerLink[] {
  if (!artifact || artifact.kind !== 'html' || !artifact.prototypeLinks?.length) return []
  const artifactsById = new Map(artifacts.map((item) => [item.id, item]))
  const artifactsByTitle = new Map(
    artifacts
      .filter((item) => item.kind === 'html')
      .map((item) => [normalizeTitle(item.title), item])
  )
  const out: PrototypePlayerLink[] = []
  const seen = new Set<string>()
  for (const link of artifact.prototypeLinks) {
    const target =
      (link.targetArtifactId ? artifactsById.get(link.targetArtifactId) : undefined) ??
      artifactsByTitle.get(normalizeTitle(link.targetTitle))
    if (!target || target.kind !== 'html' || target.id === artifact.id || seen.has(target.id)) continue
    seen.add(target.id)
    out.push({
      ...link,
      targetArtifactId: target.id,
      targetTitle: target.title
    })
  }
  return out
}
