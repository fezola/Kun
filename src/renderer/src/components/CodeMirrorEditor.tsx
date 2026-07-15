import { useEffect, useRef, useCallback, type CSSProperties, type ReactElement } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { php } from '@codemirror/lang-php'
import { sass } from '@codemirror/lang-sass'
import { yaml } from '@codemirror/lang-yaml'

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: '#d4d4d4',
    height: '100%'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '12px',
    lineHeight: '22px'
  },
  '.cm-content': {
    caretColor: '#aeafad',
    padding: '0'
  },
  '.cm-cursor': { borderLeftColor: '#aeafad' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#aeafad' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: '#858585',
    border: 'none',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    paddingRight: '4px'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '32px',
    padding: '0 8px 0 4px',
    textAlign: 'right'
  },
  '.cm-selectionBackground': { backgroundColor: 'rgba(38, 79, 120, 0.5) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(38, 79, 120, 0.7) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(97, 175, 239, 0.2)', outline: '1px solid rgba(97, 175, 239, 0.4)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(234, 92, 0, 0.3)', outline: '1px solid rgba(234, 92, 0, 0.5)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(38, 79, 120, 0.5)' },
  '.cm-foldPlaceholder': { backgroundColor: 'rgba(255,255,255,0.06)', border: 'none', color: '#858585' },
  '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#d4d4d4' },
  '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: '#094771', color: '#d4d4d4' } }
}, { dark: true })

function languageExtension(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts': case 'tsx': case 'mts': case 'cts': return javascript({ typescript: true, jsx: ext === 'tsx' })
    case 'js': case 'jsx': case 'mjs': case 'cjs': case 'es': case 'esm': return javascript({ jsx: ext === 'jsx' })
    case 'py': case 'pyw': return python()
    case 'html': case 'htm': case 'vue': case 'svelte': return html()
    case 'css': case 'scss': case 'less': return css()
    case 'json': case 'jsonc': case 'jsonl': return json()
    case 'md': case 'mdx': return markdown()
    case 'rs': return rust()
    case 'sql': return sql()
    case 'xml': case 'svg': return xml()
    case 'java': return java()
    case 'cpp': case 'cc': case 'cxx': case 'h': case 'hpp': return cpp()
    case 'php': return php()
    case 'sol': return javascript()
    case 'sass': return sass()
    case 'yaml': case 'yml': return yaml()
    default: return javascript()
  }
}

type Props = {
  content: string
  filePath: string
  onChange?: (value: string) => void
  onSave?: (value: string) => void
}

const containerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  overflow: 'hidden'
}

export function CodeMirrorEditor({ content, filePath, onChange, onSave }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  const saveValue = useCallback(() => {
    const view = viewRef.current
    if (view) onSaveRef.current?.(view.state.doc.toString())
  }, [])

  useEffect(() => {
    if (!containerRef.current || !content) return

    const saveKeymap = keymap.of([{
      key: 'Mod-s',
      run: () => { saveValue(); return true }
    }])

    const languageConf = new Compartment()

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        autocompletion(),
        saveKeymap,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        languageConf.of(languageExtension(filePath)),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        darkTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString())
        }),
        EditorView.lineWrapping
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  // Only recreate editor when filePath changes, not on every content change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content }
      })
    }
  }, [content])

  return <div ref={containerRef} style={containerStyle} />
}
