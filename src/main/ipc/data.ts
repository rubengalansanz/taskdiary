import { readFile, writeFile } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  exportRequestSchema,
  importRequestSchema,
  type ExportRequest,
  type ExportResultDto,
  type ImportRequest,
  type ImportResultDto
} from '../../shared/ipc'
import { AppError } from '../core/errors'
import { parseImportCsv, parseImportJson, toMarkdown, toTransferJson } from '../core/transfer'
import type { TasksRepository } from '../db/repositories/tasks-repo'
import { guardAsync, parseOrThrow } from './guard'

/**
 * Import and export, behind native file dialogs.
 *
 * RNF-12 says the renderer has no access to the filesystem, and this is where that promise is
 * kept: the renderer asks for a *format*, never a path. It does not learn where the file went
 * on export, and it cannot choose where to read from on import. A renderer that could name a
 * path would be a renderer that could read `~/.ssh/id_rsa`, whatever the UI offers.
 *
 * The transforms live in `core/transfer.ts` and are pure. This layer's whole job is the three
 * things they cannot do: ask the user, touch the disk, and refuse cleanly.
 */

/** File filters per format, so the dialog offers the right one by default. */
const FILTERS: Readonly<Record<'json' | 'markdown' | 'csv', { name: string; extensions: string[] }[]>> = {
  json: [{ name: 'JSON', extensions: ['json'] }],
  markdown: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  csv: [{ name: 'CSV', extensions: ['csv'] }]
}

/**
 * Registers the `data:export` and `data:import` handlers.
 *
 * @param repository Where the diary lives.
 * @param getWindow Resolves the window the dialog should be modal to. Resolved per call, not
 *   captured: the window may not exist yet when handlers are registered.
 */
export function registerDataIpcHandlers(
  repository: TasksRepository,
  getWindow: () => BrowserWindow | undefined
): void {
  ipcMain.handle(
    IPC_CHANNELS.dataExport,
    async (
    _event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<ExportResultDto | { ok: false; error: unknown }> =>
      guardAsync(async () => {
        const request: ExportRequest = parseOrThrow(exportRequestSchema, payload)
        const tasks = repository.exportAll()
        const defaultName =
          request.format === 'markdown' ? 'taskdiary.md' : 'taskdiary.json'

        const window = getWindow()
        const result = await dialog.showSaveDialog(window ?? ({} as BrowserWindow), {
          title: 'Exportar la agenda',
          defaultPath: defaultName,
          filters: FILTERS[request.format]
        })

        // Closing the dialog is not a failure. Reporting it as one would make a user who
        // changed their mind see an error they cannot dismiss.
        if (result.canceled === true || result.filePath === undefined) {
          return { ok: true, written: false, taskCount: 0 }
        }

        const contents =
          request.format === 'markdown' ? toMarkdown(tasks) : toTransferJson(tasks)

        // The path came from the OS dialog, not from the renderer. That is the whole point
        // of RNF-12: the renderer never names a file, so a non-literal path here is as
        // trustworthy as the user's own file picker — and reading one would be exactly what
        // the rule forbids, so the guarantee lives in *where* this string comes from.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await writeFile(result.filePath, contents, 'utf8')

        return { ok: true, written: true, taskCount: tasks.length }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.dataImport,
    async (
    _event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<ImportResultDto | { ok: false; error: unknown }> =>
      guardAsync(async () => {
        const request: ImportRequest = parseOrThrow(importRequestSchema, payload)
        const window = getWindow()
        const result = await dialog.showOpenDialog(window ?? ({} as BrowserWindow), {
          title: 'Importar tareas',
          properties: ['openFile'],
          filters: FILTERS[request.format]
        })

        if (result.canceled === true || result.filePaths[0] === undefined) {
          return { ok: true, imported: false, taskCount: 0 }
        }

        // Same as above: chosen in the OS dialog, never supplied by the renderer.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const text = await readFile(result.filePaths[0], 'utf8')
        const parsed = request.format === 'csv' ? parseImportCsv(text) : parseImportJson(text)

        if (!parsed.ok) {
          // Refused before a transaction opens, so the diary is exactly as it was. The message
          // is the parser's: it names the row and the field, which is what the user needs to
          // fix the file.
          throw new AppError('VALIDATION_FAILED', parsed.error, { field: 'file' })
        }

        if (parsed.tasks.length === 0) {
          throw new AppError(
            'VALIDATION_FAILED',
            'El archivo no contiene ninguna tarea, así que no se ha importado nada.',
            { field: 'file' }
          )
        }

        const taskCount = repository.importMany(parsed.tasks)

        return { ok: true, imported: true, taskCount }
      })
  )
}
