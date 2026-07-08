"""
Validates estimate_fees() against 5 real filled orders pulled earlier this session via
fees_probe.py/validate_transform.py (their actual per-order fee, from get_order_detail,
is hardcoded here as ground truth). Buy-side orders have no FINRA TAF/SEC component;
sell-side orders do -- both are covered.
"""
import pytest

from fee_rates import estimate_fees

# (label, contracts, side, principal, actual_fee_from_get_order_detail)
REAL_CASES = [
    ("SPY746P open-1 (buy 10@0.67)", 10, "buy", 10 * 0.67 * 100, 0.45),
    ("SPY746P open-2 (buy 5@0.55)", 5, "buy", 5 * 0.55 * 100, 0.23),
    ("SPY746P close (sell 15@0.34)", 15, "sell", 15 * 0.34 * 100, 0.75),
    ("SPY742P open (buy 2@0.28)", 2, "buy", 2 * 0.28 * 100, 0.09),
    ("SPY742P close (sell 2@0.12)", 2, "sell", 2 * 0.12 * 100, 0.11),
]


@pytest.mark.parametrize("label, contracts, side, principal, actual_fee", REAL_CASES)
def test_estimate_within_a_few_cents_of_real_fee(label, contracts, side, principal, actual_fee):
    # Compare at cent resolution, since that's how the fee is actually displayed/used --
    # the raw float estimate for the 15-contract sell case is $0.7183, which rounds to
    # $0.72 (a real $0.03 delta from the $0.75 actual), not the $0.0317 the unrounded
    # floats would suggest.
    estimate = round(estimate_fees(contracts, side, principal), 2)
    delta = round(abs(estimate - actual_fee), 2)
    assert delta <= 0.03, f"{label}: estimate {estimate:.2f} vs actual {actual_fee:.2f} (delta {delta:.2f})"


def test_buy_side_has_no_finra_or_sec_component():
    # FINRA TAF and the SEC fee are sell-side only -- a buy of the same size and
    # principal must come out cheaper than an equivalent sell.
    buy_fee = estimate_fees(10, "buy", 1000.0)
    sell_fee = estimate_fees(10, "sell", 1000.0)
    assert sell_fee > buy_fee


def test_sec_fee_minimum_applies_to_small_sells():
    # A tiny sale's computed SEC fee (principal * rate) would be a fraction of a cent --
    # the $0.01 minimum must still apply rather than rounding down to nothing.
    fee = estimate_fees(1, "sell", 1.00)
    # 1 contract * (OCC + ORF) + 1*FINRA_TAF + max(tiny, 0.01)
    from fee_rates import FINRA_TAF_PER_CONTRACT, OCC_CLEARING_FEE_PER_CONTRACT, ORF_FEE_PER_CONTRACT

    expected_floor = (OCC_CLEARING_FEE_PER_CONTRACT + ORF_FEE_PER_CONTRACT) + FINRA_TAF_PER_CONTRACT + 0.01
    assert fee == pytest.approx(expected_floor)
