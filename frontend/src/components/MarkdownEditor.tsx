import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from 'tiptap-markdown'
import { MarkdownHighlight, MarkdownListFixes } from './markdownExtensions'

interface Props {
  /** Markdown. What goes in and what `onChange` hands back. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Sits above the editor. */
  label?: string
}

// Options that must not change between renders. @tiptap/react compares them by identity and
// calls editor.setOptions() when they differ, which re-applies view props on every keystroke —
// harmless on a desktop, but it lands mid-composition on a phone keyboard.
const EDITOR_PROPS = { attributes: { class: 'md tiptap min-h-[16rem] px-4 py-3', spellcheck: 'true' } }

/** A note that looks like a note while you write it. The document is edited rendered — headings
 * are big, bullets are bullets, checkboxes tick — and markdown is only the storage format: it's
 * parsed on the way in and serialised on the way out, so the transcriptions the AI writes and the
 * notes people type share one column and one editor.
 *
 * Markdown habits still work: typing `# `, `- `, `1. `, `> `, `**bold**` or `==mark==` converts
 * as you go, Mod+B/I do what they do everywhere, Enter continues a list and Tab nests one. The
 * toolbar is for thumbs. There's no preview toggle because the rendered text *is* the editor. */
export default function MarkdownEditor({ value, onChange, placeholder, autoFocus, label }: Props) {
  // What we last handed up. If `value` comes back different, someone else changed it and the
  // document needs replacing; otherwise it's our own edit echoing and the caret must be left alone.
  const emitted = useRef(value)
  const initial = useRef(value)
  const [look, setLook] = useState(readLook)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // A tap in an editable document places the caret; it shouldn't also leave the app.
        link: { openOnClick: false, autolink: true },
      }),
      MarkdownListFixes, // before TaskList: it has to split mixed lists before TaskList claims them
      TaskList,
      TaskItem.configure({ nested: true }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      MarkdownHighlight,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-' }),
    ],
    [placeholder],
  )

  const editor = useEditor({
    extensions,
    content: initial.current,
    autofocus: autoFocus ? 'end' : false,
    editorProps: EDITOR_PROPS,
    onUpdate: ({ editor }) => {
      // tiptap-markdown ships no types for its storage.
      const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
      emitted.current = md
      onChange(md)
    },
  })

  useEffect(() => {
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  const changeLook = (next: Look) => {
    setLook(next)
    writeLook(next)
  }

  return (
    <div>
      {label && <div className="mb-2 text-[0.9375rem] font-bold">{label}</div>}
      <div
        className="overflow-hidden rounded-[var(--r-md)] bg-[var(--surface)]"
        style={{ '--note-font': FONTS[look.font].css, '--note-size': SIZES[look.size].css } as CSSProperties}
      >
        {editor && <Toolbar editor={editor} look={look} onLook={changeLook} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

// ---- appearance ------------------------------------------------------------------------------
// How notes are set is a reader's preference, not part of any note, so it lives on the device and
// applies to every note. Faces are system stacks: nothing to download.

const FONTS = {
  nunito: { label: 'Nunito', css: 'var(--font-body)' },
  serif: { label: 'Serif', css: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
  system: { label: 'System', css: 'system-ui, sans-serif' },
  mono: { label: 'Mono', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
} as const
const SIZES = {
  small: { label: 'Small', css: '0.875rem' },
  normal: { label: 'Normal', css: '0.9375rem' },
  large: { label: 'Large', css: '1.0625rem' },
  larger: { label: 'Larger', css: '1.1875rem' },
} as const

interface Look {
  font: keyof typeof FONTS
  size: keyof typeof SIZES
}
const LOOK_KEY = 'rekall.noteLook'
const DEFAULT_LOOK: Look = { font: 'nunito', size: 'normal' }

function readLook(): Look {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '') as Partial<Look>
    return {
      font: raw.font && raw.font in FONTS ? raw.font : DEFAULT_LOOK.font,
      size: raw.size && raw.size in SIZES ? raw.size : DEFAULT_LOOK.size,
    }
  } catch {
    return DEFAULT_LOOK
  }
}
function writeLook(look: Look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    // Private mode with storage off: the choice just doesn't stick.
  }
}

// ---- toolbar ---------------------------------------------------------------------------------

function Toolbar({ editor, look, onLook }: { editor: Editor; look: Look; onLook: (l: Look) => void }) {
  const [lookOpen, setLookOpen] = useState(false)

  // Subscribes to the editor so buttons light up for whatever the caret is in.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor.isActive('heading'),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      highlight: editor.isActive('highlight'),
      bullet: editor.isActive('bulletList'),
      numbered: editor.isActive('orderedList'),
      task: editor.isActive('taskList'),
      quote: editor.isActive('blockquote'),
      link: editor.isActive('link'),
    }),
  })

  const chain = () => editor.chain().focus()

  // H1 → H2 → H3 → plain, so one button covers every level and the way back out.
  const cycleHeading = () => {
    const level = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l }))
    if (level === undefined) chain().setHeading({ level: 1 }).run()
    else if (level === 3) chain().setParagraph().run()
    else chain().setHeading({ level: level === 1 ? 2 : 3 }).run()
  }

  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link to', current ?? 'https://')
    if (href === null) return
    const trimmed = href.trim()
    if (!trimmed || trimmed === 'https://') chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  return (
    <div className="border-b border-[var(--rule)]">
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto px-1.5 py-1">
        <ToolButton label="Font and size" active={lookOpen} onClick={() => setLookOpen((o) => !o)}>
          <span className="text-[0.9375rem] font-bold">Aa</span>
        </ToolButton>
        <span aria-hidden className="mx-1 h-5 w-px flex-shrink-0 bg-[var(--rule)]" />
        <ToolButton label="Heading" active={active.heading} onClick={cycleHeading}>
          <span className="text-[0.9375rem] font-bold">H</span>
        </ToolButton>
        {/* Headings are already bold; letting Bold apply inside one does nothing visible. */}
        <ToolButton label="Bold" active={active.bold} disabled={active.heading} onClick={() => chain().toggleBold().run()}>
          <span className="text-[0.9375rem] font-bold">B</span>
        </ToolButton>
        <ToolButton label="Italic" active={active.italic} onClick={() => chain().toggleItalic().run()}>
          <span className="font-serif text-[1.0625rem] italic">I</span>
        </ToolButton>
        <ToolButton label="Highlight" active={active.highlight} onClick={() => chain().toggleHighlight().run()}>
          {ICON_HIGHLIGHT}
        </ToolButton>
        <ToolButton label="Bulleted list" active={active.bullet} onClick={() => chain().toggleBulletList().run()}>
          {ICON_BULLETS}
        </ToolButton>
        <ToolButton label="Numbered list" active={active.numbered} onClick={() => chain().toggleOrderedList().run()}>
          {ICON_NUMBERED}
        </ToolButton>
        <ToolButton label="Checklist" active={active.task} onClick={() => chain().toggleTaskList().run()}>
          {ICON_CHECKLIST}
        </ToolButton>
        <ToolButton label="Quote" active={active.quote} onClick={() => chain().toggleBlockquote().run()}>
          {ICON_QUOTE}
        </ToolButton>
        <ToolButton label="Link" active={active.link} onClick={setLink}>
          {ICON_LINK}
        </ToolButton>
      </div>

      {lookOpen && (
        <div className="flex gap-2 border-t border-[var(--rule)] px-3 py-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">
            Font
            <select
              value={look.font}
              onChange={(e) => onLook({ ...look, font: e.target.value as Look['font'] })}
              className="h-11 min-w-0 flex-1 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 text-[0.9375rem] text-[var(--text)] outline-none"
            >
              {(Object.keys(FONTS) as Look['font'][]).map((k) => (
                <option key={k} value={k}>
                  {FONTS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] font-semibold text-[var(--text-muted)]">
            Size
            <select
              value={look.size}
              onChange={(e) => onLook({ ...look, size: e.target.value as Look['size'] })}
              className="h-11 min-w-0 flex-1 rounded-[var(--r-sm)] bg-[var(--bg)] px-3 text-[0.9375rem] text-[var(--text)] outline-none"
            >
              {(Object.keys(SIZES) as Look['size'][]).map((k) => (
                <option key={k} value={k}>
                  {SIZES[k].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Mouse-down would steal the editor's focus and with it the selection the action needs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-11 w-[38px] flex-shrink-0 items-center justify-center rounded-[var(--r-sm)] disabled:opacity-30 ${
        active ? 'bg-[var(--bg)] text-[var(--text)]' : 'text-[var(--text-muted)]'
      }`}
    >
      {children}
    </button>
  )
}

const ICON_HIGHLIGHT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l-6 6v3h3l6-6" />
    <path d="M14 6l4 4-8 8-4-4z" />
    <path d="M14 6l3-3 4 4-3 3" />
  </svg>
)

const ICON_BULLETS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="5" cy="6" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="18" r="1" fill="currentColor" />
    <path d="M10 6h10M10 12h10M10 18h10" />
  </svg>
)

const ICON_NUMBERED = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 4.5l1.5-1v5M3.8 11.2a1.4 1.4 0 0 1 2.6.7c0 1-2.6 2.3-2.6 3.1h2.8M3.8 17h1.6a1.2 1.2 0 0 1 0 2.4H4.6h.8a1.2 1.2 0 0 1 0 2.4H3.8" />
  </svg>
)

const ICON_CHECKLIST = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l2 2 3.5-4M3 17l2 2 3.5-4" />
    <path d="M12 7h9M12 17h9" />
  </svg>
)

const ICON_QUOTE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 5v14" />
    <path d="M11 8h9M11 12h9M11 16h6" />
  </svg>
)


const ICON_LINK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </svg>
)
