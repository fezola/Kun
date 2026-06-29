import { describe, expect, it } from 'vitest'
import {
  buildPrototypeNavigationCaptureScript,
  extractPrototypeNavigationHref,
  hasPrototypePlayback,
  resolveInitialPrototypeArtifactId,
  resolvePrototypeNavigationTarget,
  resolvePrototypeLinks,
  shouldCapturePrototypeNavigationHref
} from './prototype-player'
import type { DesignArtifact } from './design-types'

const now = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title,
    relativePath,
    createdAt: now,
    updatedAt: now,
    versions: [{ id: `${id}-v1`, relativePath, createdAt: now, summary: '' }],
    ...extra
  }
}

describe('prototype-player', () => {
  it('starts from the preferred HTML artifact when available', () => {
    const artifacts = [
      artifact('home', 'Home'),
      artifact('signup', 'Signup', { prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }] })
    ]

    expect(resolveInitialPrototypeArtifactId(artifacts, 'home')).toBe('home')
  })

  it('otherwise starts from the first linked HTML artifact, then first HTML artifact', () => {
    expect(resolveInitialPrototypeArtifactId([artifact('home', 'Home'), artifact('flow', 'Flow', {
      prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }]
    })])).toBe('flow')
    expect(resolveInitialPrototypeArtifactId([artifact('home', 'Home')])).toBe('home')
    expect(resolveInitialPrototypeArtifactId([{ ...artifact('board', 'Board'), kind: 'canvas' }])).toBeNull()
  })

  it('detects playback only when a link resolves to an HTML artifact', () => {
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Signup' }] }),
      artifact('signup', 'Signup')
    ])).toBe(true)
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Missing' }] })
    ])).toBe(false)
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }] })
    ])).toBe(false)
  })

  it('resolves links by id or normalized title and drops duplicate/self/missing targets', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [
        { targetTitle: 'Signup', targetArtifactId: 'signup', label: 'Start trial' },
        { targetTitle: '  DASHBOARD  ' },
        { targetTitle: 'Dashboard' },
        { targetTitle: 'Home', targetArtifactId: 'home' },
        { targetTitle: 'Missing' }
      ]
    })
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('signup', 'Signup'),
      artifact('dashboard', 'Dashboard')
    ])

    expect(links).toEqual([
      expect.objectContaining({
        targetArtifactId: 'signup',
        targetTitle: 'Signup',
        label: 'Start trial'
      }),
      expect.objectContaining({
        targetArtifactId: 'dashboard',
        targetTitle: 'Dashboard'
      })
    ])
  })

  it('resolves prototype navigation from captured href hashes or absolute urls', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [
        {
          targetTitle: 'Signup',
          targetArtifactId: 'signup',
          href: '../signup/v1.html',
          label: 'Start trial'
        }
      ]
    })
    const links = resolvePrototypeLinks(home, [home, artifact('signup', 'Signup')])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=..%2Fsignup%2Fv1.html',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/signup/v1.html?rev=2',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(resolvePrototypeNavigationTarget('https://example.com', currentFileUrl, links)).toBeNull()
  })

  it('extracts captured prototype hrefs and leaves ordinary hashes alone', () => {
    expect(extractPrototypeNavigationHref('#kun-proto-nav=..%2Fsignup%2Fv1.html')).toBe('../signup/v1.html')
    expect(extractPrototypeNavigationHref('file:///x.html#section')).toBeNull()
  })

  it('captures unknown local prototype hrefs but lets anchors and external links behave normally', () => {
    const base = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(shouldCapturePrototypeNavigationHref('../billing/v1.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('/workspace/proto/settings.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('file:///workspace/proto/settings.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('#pricing', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('?tab=settings', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('mailto:hello@example.com', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('https://example.com/demo', base)).toBe(false)
  })

  it('builds a capture script scoped to known flow hrefs', () => {
    const script = buildPrototypeNavigationCaptureScript([
      {
        targetTitle: 'Signup',
        targetArtifactId: 'signup',
        href: '../signup/v1.html'
      }
    ])

    expect(script).toContain('../signup/v1.html')
    expect(script).toContain('kun-proto-nav=')
    expect(script).toContain('allowed.has')
    expect(script).toContain('shouldCapture')
  })
})
