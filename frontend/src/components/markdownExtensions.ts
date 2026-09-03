import { Extension } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import type MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'

/** Two gaps between tiptap-markdown and how people actually write lists.
 *
 * 1. A list that mixes `- [ ] task` and `- plain` items is one list in CommonMark, and the task
 *    plugin flags the whole thing as a task list. ProseMirror's task list only holds task items,
 *    so the plain ones came out as an empty phantom checkbox. Split such a list into runs before
 *    the schema sees it: consecutive task items become a task list, the rest a plain list.
 * 2. Task lists had no `tight` attribute, so they always serialised with blank lines between
 *    items (and re-parsed looser each round trip). Give them the same attribute bullet and
 *    numbered lists get.
 */
export const MarkdownListFixes = Extension.create({
  name: 'markdownListFixes',

  addGlobalAttributes() {
    return [
      {
        types: ['taskList'],
        attributes: {
          tight: {
            default: true,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
            renderHTML: (attrs: { tight?: boolean }) => ({ 'data-tight': attrs.tight ? 'true' : null }),
          },
        },
      },
    ]
  },

  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            const isTask = (li: Element) => li.classList.contains('task-list-item') || li.getAttribute('data-type') === 'taskItem'
            for (const list of Array.from(element.querySelectorAll('ul.contains-task-list, ul[data-type="taskList"]'))) {
              const items = Array.from(list.children)
              if (items.every(isTask)) continue
              const runs: { task: boolean; items: Element[] }[] = []
              for (const li of items) {
                const task = isTask(li)
                const last = runs[runs.length - 1]
                if (last && last.task === task) last.items.push(li)
                else runs.push({ task, items: [li] })
              }
              for (const run of runs) {
                const ul = list.ownerDocument.createElement('ul')
                if (run.task) {
                  ul.className = 'contains-task-list'
                  ul.setAttribute('data-type', 'taskList')
                }
                for (const li of run.items) ul.appendChild(li)
                list.parentNode?.insertBefore(ul, list)
              }
              list.remove()
            }
          },
        },
      },
    }
  },
})

/** Highlighter. Markdown has no standard for it; `==text==` is the convention Obsidian, Typora
 * and markdown-it's own plugin share, so that's what gets stored. Without this spec the mark
 * would be silently dropped on save. */
export const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
        parse: {
          setup(md: MarkdownIt) {
            md.use(markdownItMark)
          },
        },
      },
    }
  },
})
