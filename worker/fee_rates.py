"""
Estimated Webull options regulatory fees -- pure formula, zero API calls. These are
industry-wide regulatory pass-throughs (not Webull commissions -- Webull doesn't charge
options commissions), but the published per-contract/per-dollar rates change
periodically as regulators and exchanges adjust them.

Rates below are effective as of 2025 -- verify current rates before trusting this
beyond a rough placeholder estimate:

    OCC clearing fee:              https://www.theocc.com/clearance-and-settlement/fees
    ORF (Options Regulatory Fee):  set per-exchange (varies ~$0.02135-$0.02695/contract);
                                    e.g. https://www.nasdaq.com/solutions/nasdaq-fee-schedules.
                                    Using the midpoint as one representative rate since we
                                    don't know which exchange routed any given order.
    FINRA TAF (Trading Activity Fee): https://www.finra.org/rules-guidance/rulebooks/finra-rules/7000
    SEC Section 31 fee:             https://www.sec.gov/answers/sec31.htm

Hand-validated against 5 real filled orders (see test_fee_rates.py): buy-side estimates
landed within $0.01 of the real per-order fee in every case; sell-side (which also
carries FINRA TAF + SEC fee) landed within $0.01-$0.03. Close enough to serve as an
instant placeholder while the real fee backfills in the background (see fees.py).
"""
from __future__ import annotations

# --- Rates effective as of 2025 -- confirm against the sources above before relying on
# --- these beyond a rough placeholder estimate; regulators adjust them periodically.
OCC_CLEARING_FEE_PER_CONTRACT = 0.02  # both sides (buy and sell)
ORF_FEE_PER_CONTRACT = (0.02135 + 0.02695) / 2  # both sides; midpoint of the published range
FINRA_TAF_PER_CONTRACT = 0.00279  # sell side only
SEC_FEE_RATE = 27.80 / 1_000_000  # sell side only -- $27.80 per $1,000,000 of principal
SEC_FEE_MINIMUM = 0.01  # sell side only, applied whenever a sale incurs a (nonzero) SEC fee


def estimate_fees(contracts: float, side: str, principal: float) -> float:
    """
    Estimates the regulatory fees for one options order. No network calls.

    :param contracts: number of contracts in the order (quantity)
    :param side: "buy" or "sell"
    :param principal: total notional value of the order
                       (price_per_contract * contracts * option_contract_multiplier)
    """
    fee = contracts * (OCC_CLEARING_FEE_PER_CONTRACT + ORF_FEE_PER_CONTRACT)

    if side == "sell":
        fee += contracts * FINRA_TAF_PER_CONTRACT
        if principal > 0:
            fee += max(principal * SEC_FEE_RATE, SEC_FEE_MINIMUM)

    return fee
