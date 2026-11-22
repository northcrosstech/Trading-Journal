/** Physical metals are held under a plain name and priced per troy ounce at the spot price
 * of this pair (the worker's TWELVEDATA_ALIASES and SPOT_METALS in worker/prices.py). */
export const METAL_PRICE_SOURCE: Record<string, string> = {
  GOLD: 'XAU/USD',
  SILVER: 'XAG/USD',
}

export const metalPriceSource = (symbol: string): string | undefined => METAL_PRICE_SOURCE[symbol]
