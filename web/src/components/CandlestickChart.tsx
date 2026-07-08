import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import type { Candle } from '../lib/candles'

export type ChartMarker = {
  time: number // unix seconds
  position: 'aboveBar' | 'belowBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle'
  text: string
}

export function CandlestickChart({ candles, markers }: { candles: Candle[]; markers: ChartMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: { background: { color: 'transparent' }, textColor: '#898781' },
      grid: {
        vertLines: { color: '#2c2c2a' },
        horzLines: { color: '#2c2c2a' },
      },
      timeScale: { borderColor: '#383835', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#383835' },
      crosshair: { mode: 0 },
      autoSize: true,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#0ca30c',
      downColor: '#d03b3b',
      borderVisible: false,
      wickUpColor: '#0ca30c',
      wickDownColor: '#d03b3b',
    })

    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )

    if (markers.length > 0) {
      const seriesMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }))
      createSeriesMarkers(series, seriesMarkers)
    }

    chart.timeScale().fitContent()

    return () => chart.remove()
  }, [candles, markers])

  return <div ref={containerRef} className="h-80 w-full" />
}
