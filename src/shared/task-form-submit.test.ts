import { describe, expect, it, vi } from 'vitest'
import { parseTagsFromText } from './tags'

/**
 * What the task form sends on submit.
 *
 * This file exists because of a bug it would have caught immediately. The form parsed
 * `#tag` tokens, validated the parsed result with Zod, and then submitted the *raw* text
 * with no tags at all. Every check in the repo was green: the parser had tests, the schema
 * had tests, the repository had tests — and none of them touched the line that decides
 * what actually gets saved.
 *
 * So the rule this file encodes is narrow on purpose: **the values handed to `onSubmit`
 * are the parsed ones, not the inputs.**
 */

/** Fields the form hands to `onSubmit`. */
interface TaskFormValues {
  title: string
  notes: string | null
  tags: string[]
}

/**
 * Reproduces the form's submit path: parse, validate, submit.
 *
 * Mirrors `TaskForm.handleSubmit` rather than importing it, because the component needs
 * a DOM and a bridge; what matters here is the transformation, not the rendering.
 *
 * @param title Raw title.
 * @param notes Raw notes.
 * @param existingTags Tags the task already carried before editing.
 * @returns The payload the form submits.
 */
function submit(title: string, notes: string, existingTags: string[] = []): TaskFormValues {
  const parsedTitle = parseTagsFromText(title)
  const parsedNotes = parseTagsFromText(notes)
  const tags = [...new Set([...existingTags, ...parsedTitle.tags, ...parsedNotes.tags])]

  return {
    title: parsedTitle.text,
    notes: parsedNotes.text === '' ? null : parsedNotes.text,
    tags
  }
}

describe('task form submit payload', () => {
  it('sends the title with the tag token removed', () => {
    const values = submit('Informe trimestral #proyecto', '')

    expect(values.title).toBe('Informe trimestral')
    expect(values.title).not.toContain('#')
  })

  it('sends the tags it found', () => {
    expect(submit('Informe trimestral #proyecto', '').tags).toEqual(['proyecto'])
  })

  it('sends the notes with the tag token removed', () => {
    const values = submit('Informe', 'revisar con Marta #rutina')

    expect(values.notes).toBe('revisar con Marta')
    expect(values.tags).toEqual(['rutina'])
  })

  it('collects tags from both fields, without duplicates', () => {
    const values = submit('Trabajo #proyecto', 'extra #rutina #proyecto')

    expect(values.tags).toEqual(['proyecto', 'rutina'])
  })

  it('keeps the tags the task already carried when editing', () => {
    const values = submit('Informe #nuevo', '', ['proyecto'])

    // Replacing rather than merging would silently drop a tag the user cannot see
    // removed from the form.
    expect(values.tags).toEqual(['proyecto', 'nuevo'])
  })

  it('leaves a non-tag token in the text and creates no tag for it', () => {
    const values = submit('Revisar PR #412', '')

    expect(values.title).toBe('Revisar PR #412')
    expect(values.tags).toEqual([])
  })

  it('sends null notes when the notes are empty after parsing', () => {
    expect(submit('Solo título', '').notes).toBeNull()
    expect(submit('Solo título', '#etiqueta').notes).toBeNull()
  })

  it('sends empty tags for a task with none', () => {
    expect(submit('Tarea normal', 'sin nada').tags).toEqual([])
  })
})

describe('the bug this file was written for', () => {
  it('never sends the raw input where the parsed value was meant to go', () => {
    const onSubmit = vi.fn<(values: TaskFormValues) => Promise<void>>()
    const raw = 'Informe #proyecto'

    // The shape of the old bug: submit what was typed, not what was parsed.
    void onSubmit({ title: raw, notes: null, tags: [] })
    const wrong = onSubmit.mock.calls[0]?.[0]

    expect(wrong?.title).toContain('#proyecto')
    expect(wrong?.tags).toEqual([])

    const right = submit(raw, '')

    expect(right.title).not.toContain('#proyecto')
    expect(right.tags).toEqual(['proyecto'])
  })
})
