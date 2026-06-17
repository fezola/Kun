import { desktopCapturer, shell, systemPreferences } from 'electron'

export type ComputerUsePermissionState = 'granted' | 'denied' | 'unknown'

export type ComputerUsePermissions = {
  platform: NodeJS.Platform
  /** Whether the host backend can run on this platform at all. */
  supported: boolean
  /** Whether the OS gates input/capture behind a permission prompt (macOS). */
  needsPermission: boolean
  /** Accessibility permission (controls mouse/keyboard injection on macOS). */
  accessibility: ComputerUsePermissionState
  /** Screen Recording permission (controls screenshots on macOS). */
  screenRecording: ComputerUsePermissionState
}

/**
 * The native macOS permission helper bundled with @computer-use/nut-js.
 * Its `askFor*` calls use the canonical TCC registration APIs
 * (AXIsProcessTrustedWithOptions / CGRequestScreenCaptureAccess) which
 * proactively add the app to the Accessibility / Screen Recording lists —
 * so the user only has to flip the toggle rather than add Kun by hand.
 */
type MacPermissions = {
  getAuthStatus(type: 'accessibility' | 'screen'): string
  askForAccessibilityAccess(): unknown
  askForScreenCaptureAccess(openPreferences?: boolean): unknown
}

let macPermissionsLoaded = false
let macPermissions: MacPermissions | null = null

async function loadMacPermissions(): Promise<MacPermissions | null> {
  if (!macPermissionsLoaded) {
    macPermissionsLoaded = true
    try {
      // node-mac-permissions is a transitive native dep (a .node addon), so it
      // is NOT externalized by electron-vite's direct-deps plugin. Load it via
      // a variable specifier + @vite-ignore so Rollup leaves it as a runtime
      // import instead of trying (and failing) to bundle the native binary.
      const specifier = '@computer-use/node-mac-permissions'
      const ns = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
      macPermissions = ((ns as { default?: unknown }).default ?? ns) as MacPermissions
    } catch {
      macPermissions = null
    }
  }
  return macPermissions
}

function normalizeState(status: string | undefined): ComputerUsePermissionState {
  if (status === 'authorized' || status === 'granted') return 'granted'
  if (status === 'not determined' || status === 'not-determined' || status === undefined) return 'unknown'
  return 'denied'
}

/**
 * Report the host-control OS permission status. On macOS, computer-use
 * needs Accessibility (input injection) and Screen Recording (capture);
 * on Windows/Linux no special permission gate applies. Checks are
 * read-only — they never trigger a system prompt.
 */
export function getComputerUsePermissions(): ComputerUsePermissions {
  const platform = process.platform
  if (platform !== 'darwin') {
    return {
      platform,
      supported: true,
      needsPermission: false,
      accessibility: 'granted',
      screenRecording: 'granted'
    }
  }
  let accessibility: ComputerUsePermissionState = 'unknown'
  try {
    accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
  } catch {
    accessibility = 'unknown'
  }
  let screenRecording: ComputerUsePermissionState = 'unknown'
  try {
    screenRecording = normalizeState(systemPreferences.getMediaAccessStatus('screen'))
  } catch {
    screenRecording = 'unknown'
  }
  return { platform, supported: true, needsPermission: true, accessibility, screenRecording }
}

/**
 * Proactively enroll Kun in the relevant macOS permission list and open
 * the settings pane. Prefers the native node-mac-permissions APIs (which
 * register the app in the list so the user just toggles it on); falls
 * back to Electron primitives if the native module is unavailable.
 * Returns the refreshed status. The registration runs in the app bundle
 * (main process); the nut.js capture/inject child shares the same signed
 * bundle and inherits the grant.
 */
export async function requestComputerUsePermission(
  kind: 'accessibility' | 'screenRecording'
): Promise<ComputerUsePermissions> {
  if (process.platform !== 'darwin') return getComputerUsePermissions()
  const native = await loadMacPermissions()
  try {
    if (kind === 'accessibility') {
      if (native?.askForAccessibilityAccess) {
        // Registers Kun in the Accessibility list + opens the pane.
        native.askForAccessibilityAccess()
      } else {
        // Fallback: prompt adds the app to the Accessibility list.
        systemPreferences.isTrustedAccessibilityClient(true)
      }
    } else {
      if (native?.askForScreenCaptureAccess) {
        // CGRequestScreenCaptureAccess: registers Kun in the Screen
        // Recording list, then open the pane so the user can enable it.
        native.askForScreenCaptureAccess(true)
      } else {
        // Fallback: a one-shot capture enrolls the bundle, then open prefs.
        try {
          await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        } catch {
          // ignore — best effort
        }
      }
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
  } catch {
    // Best effort — fall through to returning the current status.
  }
  return getComputerUsePermissions()
}
