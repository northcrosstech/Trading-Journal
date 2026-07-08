import type { DailyTargetStatus } from '../lib/metrics'

/** Calendar-day marker for the daily target/loss-limit feature: solid green check =
 * hit target at close, hollow amber check = reached target intraday but gave it
 * back, red flag = breached the loss limit. Nothing rendered for 'neutral'. */
export function TargetMarkerIcon({ status }: { status: DailyTargetStatus }) {
  if (status === 'hit_target') {
    return (
      <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
        <title>Hit target at close</title>
        <path d="M4 10.5l4 4 8-9" stroke="var(--status-good)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'gave_it_back') {
    return (
      <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
        <title>Reached target intraday, gave it back by close</title>
        <path d="M4 10.5l4 4 8-9" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </svg>
    )
  }
  if (status === 'breached_loss') {
    return (
      <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
        <title>Breached loss limit</title>
        <path d="M5 3v14" stroke="var(--status-critical)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5 3.5h9l-2.5 3 2.5 3H5z" fill="var(--status-critical)" />
      </svg>
    )
  }
  return null
}
