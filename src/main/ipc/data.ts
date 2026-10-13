import { readFile, writeFile } from 'node:fs/promises'
import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import {
  IPC_CHANNELS,
  exportRequestSchema,
  importRequestSchema,
  type ExportFormat,
  type ExportRequest,
  type ExportResultDto,
  type ImportFormat,
  type ImportRequest,
  type ImportResultDto
} from '../../shared/ipc'
import { AppError } from '../core/errors'
import { parseSpreadsheet, toSpreadsheet, type SheetFormat } from '../core/sheets'
import { parseImportJson, toMarkdown, toTransferJson } from '../core/transfer'
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
/**
 * Formats that are written as bytes rather than as text.
 *
 * A spreadsheet is a ZIP or an OLE2 container, not a string. Encoding one as UTF-8 does not
 * round-trip — it produces a file no application can open — so these formats are read and
 * written as buffers and text ones keep using the default encoding.
 */
const BINARY_FORMATS: ReadonlySet<ExportFormat> = new Set(['xlsx', 'xls', 'ods'])

/** The extension a format is saved under, kept beside the filters that declare it. */
const DEFAULT_EXTENSIONS: Readonly<Record<ExportFormat, string>> = {
  json: 'json',
  markdown: 'md',
  csv: 'csv',
  xlsx: 'xlsx',
  xls: 'xls',
  ods: 'ods'
}

const FILTERS: Readonly<Record<ExportFormat, { name: string; extensions: string[] }[]>> = {
  json: [{ name: 'JSON', extensions: ['json'] }],
  markdown: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  csv: [{ name: 'CSV', extensions: ['csv'] }],
  xlsx: [{ name: 'Excel', extensions: ['xlsx'] }],
  xls: [{ name: 'Excel 97-2003', extensions: ['xls'] }],
  ods: [{ name: 'OpenDocument', extensions: ['ods'] }]
}

/**
 * True when the format is one of the spreadsheet containers.
 *
 * @param format The format to test.
 * @returns Whether it is read and written as bytes.
 */
function isSheetFormat(format: ExportFormat | ImportFormat): format is SheetFormat {
  return BINARY_FORMATS.has(format)
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
        const saveOptions: SaveDialogOptions = {
          title: 'Exportar la agenda',
          // The extension follows the format. Suggesting `taskdiary.json` for an .xlsx export
          // produces a file Excel refuses to open, and the user has no way to know why.
          defaultPath: `taskdiary.${DEFAULT_EXTENSIONS[request.format]}`,
          filters: FILTERS[request.format]
        }

        const window = getWindow()
        // Two overloads rather than a cast: `{} as BrowserWindow` is a lie the compiler
        // accepts and only Electron forgives.
        const result =
          window === undefined
            ? await dialog.showSaveDialog(saveOptions)
            : await dialog.showSaveDialog(window, saveOptions)

        // Closing the dialog is not a failure. Reporting it as one would make a user who
        // changed their mind see an error they cannot dismiss.
        if (result.canceled === true || result.filePath === undefined) {
          return { ok: true, written: false, taskCount: 0 }
        }

        // One place decides how a format becomes bytes, so export and import cannot disagree
        // about which formats are text and which are containers.
        const contents = isSheetFormat(request.format)
          ? toSpreadsheet(tasks, request.format)
          : request.format === 'markdown'
            ? Buffer.from(toMarkdown(tasks), 'utf8')
            : Buffer.from(toTransferJson(tasks), 'utf8')

        // The path came from the OS dialog, not from the renderer. That is the whole point
        // of RNF-12: the renderer never names a file, so a non-literal path here is as
        // trustworthy as the user's own file picker — and reading one would be exactly what
        // the rule forbids, so the guarantee lives in *where* this string comes from.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await writeFile(result.filePath, contents)

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
        const openOptions: OpenDialogOptions = {
          title: 'Importar tareas',
          properties: ['openFile'],
          filters: FILTERS[request.format]
        }

        const window = getWindow()
        const result =
          window === undefined
            ? await dialog.showOpenDialog(openOptions)
            : await dialog.showOpenDialog(window, openOptions)

        if (result.canceled === true || result.filePaths[0] === undefined) {
          return { ok: true, imported: false, taskCount: 0 }
        }

        // Same as above: chosen in the OS dialog, never supplied by the renderer.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const bytes = await readFile(result.filePaths[0])
        const parsed = isSheetFormat(request.format)
          ? parseSpreadsheet(bytes, request.format)
          : parseImportJson(bytes.toString('utf8'))

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
