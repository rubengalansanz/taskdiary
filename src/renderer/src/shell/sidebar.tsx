import { useId } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Separator } from '../components/ui/separator'
import { useUiStore } from '../stores/ui-store'
import { useSearch, useTags } from '../hooks/use-search'
import type { TaskStatusDto } from '../../../shared/ipc'

/**
 * Filter sidebar: search box, status toggles, tag toggles, and the result counter.
 *
 * The counter is the reason this is its own component. "12 resultados" is the only
 * feedback that says the filters are doing something, and the acceptance criterion of
 * Fase 3 is that the number reflects what is actually on screen — so it comes from the
 * search result, never from the length of whatever happened to be rendered.
 */

/** Status labels, in the order the plan's layout shows them. */
const STATUS_LABELS: ReadonlyArray<{ value: TaskStatusDto; label: string; dot: string }> = [
  { value: 'pending', label: 'Pendiente', dot: 'bg-amber-500' },
  { value: 'in_progress', label: 'En curso', dot: 'bg-blue-500' },
  { value: 'done', label: 'Completada', dot: 'bg-green-600' },
  { value: 'cancelled', label: 'Cancelada', dot: 'bg-neutral-400' }
]

/** Props of {@link Sidebar}. */
export interface SidebarProps {
  /**
   * How many tasks are currently visible.
   *
   * When a search is running the counter reports the *search* total rather than this, so
   * the number never mixes two different populations.
   */
  visibleCount: number
}

/**
 * Renders the sidebar.
 *
 * @param props Count of tasks currently shown.
 * @returns The sidebar element.
 */
export function Sidebar({ visibleCount }: SidebarProps): React.JSX.Element {
  const searchId = useId()

  const query = useUiStore((state) => state.searchQuery)
  const setSearchQuery = useUiStore((state) => state.setSearchQuery)
  const statusFilter = useUiStore((state) => state.statusFilter)
  const toggleStatus = useUiStore((state) => state.toggleStatusFilter)
  const tagFilter = useUiStore((state) => state.tagFilter)
  const toggleTag = useUiStore((state) => state.toggleTagFilter)
  const clearFilters = useUiStore((state) => state.clearFilters)

  const {
    tasks: rows,
    total,
    truncated,
    status,
    isDebouncing
  } = useSearch(query, statusFilter, tagFilter)
  const { tags, isLoading: tagsLoading } = useTags()

  const hasFilters = query.length > 0 || statusFilter.length > 0 || tagFilter.length > 0
  const searching = query.trim().length > 0

  // While a filter is live the counter reports what the search found, not the day's length,
  // so the number never mixes two populations.
  const filtered = searching || statusFilter.length > 0 || tagFilter.length > 0
  const count = filtered ? total : visibleCount

  return (
    <aside className="border-border flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4">
      <div className="space-y-2">
        <label htmlFor={searchId} className="text-sm font-medium">
          Buscar
        </label>
        <Input
          id={searchId}
          type="search"
          data-testid="search-input"
          value={query}
          placeholder="Buscar en todo el histórico"
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide uppercase">Filtros</p>

        {STATUS_LABELS.map(({ value, label, dot }) => (
          <label
            key={value}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
          >
            <input
              type="checkbox"
              data-testid={`filter-status-${value}`}
              checked={statusFilter.includes(value)}
              onChange={() => toggleStatus(value)}
              className="accent-primary"
            />
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>

      <Separator />

      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide uppercase">Etiquetas</p>

        {tagsLoading && <p className="text-muted-foreground text-xs">Cargando…</p>}

        {!tagsLoading && tags.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Escribe <code className="bg-muted rounded px-1">#etiqueta</code> en una tarea para crear
            la primera.
          </p>
        )}

        {tags.map((tag) => (
          <label
            key={tag.id}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
          >
            <input
              type="checkbox"
              data-testid={`filter-tag-${tag.name}`}
              checked={tagFilter.includes(tag.id)}
              onChange={() => toggleTag(tag.id)}
              className="accent-primary"
            />
            <span className="truncate">#{tag.name}</span>
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">
              {tag.taskCount}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-auto space-y-2 pt-2">
        <p data-testid="result-count" className="text-sm tabular-nums">
          {status === 'loading' || isDebouncing ? (
            'Buscando…'
          ) : (
            <>
              {count} {count === 1 ? 'resultado' : 'resultados'}
              {/* The cap is invisible unless we say how much is not on screen. "500
                  resultados" when there are 1200 is a lie the user cannot detect. */}
              {truncated && rows.length < count && (
                <span className="text-muted-foreground"> (mostrando {rows.length})</span>
              )}
            </>
          )}
        </p>

        {filtered && <p className="text-muted-foreground text-xs">Buscando en todo el histórico</p>}

        {hasFilters && (
          <Button variant="ghost" size="sm" data-testid="clear-filters" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>
    </aside>
  )
}
