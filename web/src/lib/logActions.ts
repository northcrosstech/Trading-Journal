/** What the Log menu can open in the drawer, one form each. Buying and selling shares is
 * not here: that is the quick form on the Positions tab. */
export type LogAction = 'deposit' | 'withdrawal' | 'dividend' | 'balance' | 'option' | 'existing' | 'transfer' | 'split'

export const LOG_TITLE: Record<LogAction, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdraw',
  dividend: 'Dividend',
  balance: 'Match broker balance',
  option: 'Option',
  existing: 'Shares I already own',
  transfer: 'Transfer',
  split: 'Stock split',
}

/** One line under the drawer title saying what the entry does to cash and returns. */
export const LOG_HINT: Record<LogAction, string> = {
  deposit: 'Deposits and withdrawals are money in/out, not a gain or loss.',
  withdrawal: 'Deposits and withdrawals are money in/out, not a gain or loss.',
  dividend: 'Dividends count as earnings.',
  balance: 'Sets cash to what your broker shows, including margin.',
  option: '',
  existing: 'Shares you already own or moved in. Counts as money added, not a purchase — cash isn’t touched.',
  transfer: 'Move shares to another portfolio, or out of the app. The average cost carries over — it isn’t a sale.',
  split: 'A stock split or reverse split. Shares and average cost change; total cost and cash don’t.',
}

export const isCashAction = (a: LogAction) => a === 'deposit' || a === 'withdrawal' || a === 'dividend' || a === 'balance'
