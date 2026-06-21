/** Shared callback bridge for creating HTML artifacts from canvas operations. */

type ScreenArtifactFactory = (name: string) => string | null

let _factory: ScreenArtifactFactory | null = null

export function setScreenArtifactFactory(fn: ScreenArtifactFactory): void {
  _factory = fn
}

export function getScreenArtifactFactory(): ScreenArtifactFactory | null {
  return _factory
}
