import type { Playbook, TradeWithDetails } from '../lib/database.types'
import type { TradeJournal } from '../lib/useTradeJournal'
import { MISTAKE_TAGS } from '../lib/mistakes'
import { tagChipStyle } from '../lib/tagColors'

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1.5 rounded border border-neutral-700 px-1 text-[10px] text-neutral-500">{children}</kbd>
}

/** The whole per-trade journal: planned?, setup, mistakes, one note, screenshot.
 * `shortcuts` shows the review queue's key hints next to each control. */
export function TradeJournalPanel({
  trade,
  journal,
  setups,
  shortcuts = false,
}: {
  trade: TradeWithDetails
  journal: TradeJournal
  setups: Playbook[]
  shortcuts?: boolean
}) {
  const currentSetupId = trade.trade_playbooks?.playbook_id ?? null
  const visibleSetups = setups.filter((s) => !s.archived || s.id === currentSetupId)

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">Was it in your plan?</h3>
        <div className="grid grid-cols-2 gap-2">
          {([true, false] as const).map((value) => {
            const active = trade.planned === value
            return (
              <button
                key={String(value)}
                onClick={() => journal.setPlanned(active ? null : value)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  active
                    ? value
                      ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
                      : 'border-amber-600 bg-amber-950/50 text-amber-300'
                    : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                {value ? 'Planned' : 'Unplanned'}
                {shortcuts && <Kbd>{value ? 'P' : 'U'}</Kbd>}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">Mistakes</h3>
        <div className="flex flex-wrap gap-1.5">
          {MISTAKE_TAGS.map((tag, i) => {
            const active = trade.mistakes.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => journal.toggleMistake(tag)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  active ? 'border-red-500/60 bg-red-950/60 text-red-300' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                {tag}
                {shortcuts && <Kbd>{String(i + 1)}</Kbd>}
              </button>
            )
          })}
          {/* Legacy free-form tags carried over from older versions stay visible/removable. */}
          {trade.mistakes
            .filter((m) => !(MISTAKE_TAGS as readonly string[]).includes(m))
            .map((m) => (
              <button
                key={m}
                onClick={() => journal.toggleMistake(m)}
                className="rounded-full border border-red-500/60 bg-red-950/60 px-2.5 py-1 text-xs font-medium text-red-300"
              >
                {m} ×
              </button>
            ))}
        </div>
        {trade.mistakes.length === 0 && trade.reviewed_at && (
          <p className="mt-1.5 text-xs text-emerald-500/80">Clean trade — no mistakes.</p>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">Setup</h3>
        {visibleSetups.length === 0 ? (
          <p className="text-xs text-neutral-600">No setups yet — add them in Settings.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleSetups.map((s) => {
              const active = s.id === currentSetupId
              return (
                <button
                  key={s.id}
                  onClick={() => journal.setSetup(active ? null : s)}
                  style={active ? tagChipStyle(s.color) : undefined}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active ? '' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {s.icon && <span className="mr-1">{s.icon}</span>}
                  {s.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Note</h3>
          <span className="text-[11px] text-neutral-600">{journal.noteSaved ? '' : 'Saving…'}</span>
        </div>
        <textarea
          value={journal.note}
          onChange={(e) => journal.setNote(e.target.value)}
          placeholder="What did you see? What would you do differently?"
          rows={4}
          className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">Screenshot</h3>
        {journal.screenshotUrl ? (
          <div className="relative">
            <img src={journal.screenshotUrl} alt="Trade screenshot" className="w-full rounded-lg border border-neutral-800" />
            <button
              onClick={journal.removeScreenshot}
              className="absolute right-2 top-2 rounded-md bg-neutral-950/80 px-2 py-1 text-xs text-neutral-300 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-xs text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
            {journal.uploading ? 'Uploading…' : 'Paste (Ctrl+V) or click to add'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={journal.uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) journal.uploadScreenshot(file)
              }}
            />
          </label>
        )}
      </section>

      {journal.error && <p className="text-xs text-(--status-critical)">Couldn't save: {journal.error}</p>}
    </div>
  )
}
