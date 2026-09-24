"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { formatInr } from "@/lib/domain/money";
import { EChart, paletteFor, useChartTheme, type ChartTheme } from "@/features/analytics/echart";

type TooltipRow = { seriesName?: string; name?: string; marker?: string; value: number; percent?: number };
type Series = { name: string; values: number[] };

const shortDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5).replace("-", "/") : value);
const countFormat = (value: number) => new Intl.NumberFormat("en-IN").format(value);
const compactInr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(paise / 100);
const valueFormat = (money: boolean) => (money ? formatInr : countFormat);

function EmptyChart({ height = 288 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground" style={{ height }}>
      No data for the selected range
    </div>
  );
}

function baseTooltip(theme: ChartTheme, trigger: "axis" | "item") {
  return {
    trigger,
    backgroundColor: theme.tooltipBg,
    borderColor: theme.border,
    borderWidth: 1,
    padding: [8, 12] as [number, number],
    textStyle: { color: theme.foreground, fontSize: 12 },
    extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgb(0 0 0 / 0.08);",
    axisPointer: { type: "shadow" as const, shadowStyle: { color: `${theme.border}55` } },
  };
}

function axisStyle(theme: ChartTheme) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: theme.border, type: "dashed" as const } },
  };
}

function axisTooltip(theme: ChartTheme, money: boolean) {
  return {
    ...baseTooltip(theme, "axis"),
    formatter: (rows: TooltipRow[]) =>
      `<div style="font-weight:600;margin-bottom:4px">${rows[0]?.name ?? ""}</div>${rows
        .map((row) => `${row.marker ?? ""} ${row.seriesName}: <b>${valueFormat(money)(row.value)}</b>`)
        .join("<br/>")}`,
  };
}

/** Smooth line with a gradient area — a single measure tracked over days. */
export function TrendChart({
  dates,
  values,
  name,
  label,
  money = false,
}: {
  dates: string[];
  values: number[];
  name: string;
  label: string;
  money?: boolean;
}) {
  const theme = useChartTheme();
  const option = useMemo<EChartsCoreOption>(
    () => ({
      color: [theme.palette[0]],
      grid: { left: 8, right: 16, top: 24, bottom: dates.length > 14 ? 44 : 8, containLabel: true },
      tooltip: { ...axisTooltip(theme, money), axisPointer: { type: "line", lineStyle: { color: theme.border } } },
      xAxis: { type: "category", boundaryGap: false, data: dates, ...axisStyle(theme), splitLine: { show: false }, axisLabel: { color: theme.muted, fontSize: 11, formatter: shortDate } },
      yAxis: { type: "value", minInterval: money ? undefined : 1, ...axisStyle(theme), axisLabel: { color: theme.muted, fontSize: 11, formatter: money ? compactInr : countFormat } },
      dataZoom: dates.length > 14 ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 8, borderColor: theme.border, fillerColor: `${theme.palette[0]}22`, handleStyle: { color: theme.palette[0] }, textStyle: { color: theme.muted, fontSize: 10 }, labelFormatter: (_: number, value: string) => shortDate(value) }] : undefined,
      series: [
        {
          name,
          type: "line",
          smooth: true,
          showSymbol: false,
          symbol: "circle",
          symbolSize: 7,
          emphasis: { focus: "series", scale: 1.4 },
          lineStyle: { width: 3 },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${theme.palette[0]}55` }, { offset: 1, color: `${theme.palette[0]}00` }] } },
          data: values,
        },
      ],
    }),
    [dates, values, name, money, theme],
  );
  if (!dates.length) return <EmptyChart />;
  return <EChart option={option} label={label} />;
}

/** Bars for one or more series — grouped, stacked, vertical or horizontal. */
export function BarChart({
  categories,
  series,
  label,
  money = false,
  stacked = false,
  horizontal = false,
  dateAxis = false,
  height = 288,
}: {
  categories: string[];
  series: Series[];
  label: string;
  money?: boolean;
  stacked?: boolean;
  horizontal?: boolean;
  dateAxis?: boolean;
  height?: number;
}) {
  const theme = useChartTheme();
  const option = useMemo<EChartsCoreOption>(() => {
    const categoryAxis = {
      type: "category" as const,
      data: categories,
      ...axisStyle(theme),
      splitLine: { show: false },
      axisLabel: { color: theme.muted, fontSize: 11, formatter: dateAxis ? shortDate : undefined, width: horizontal ? 130 : undefined, overflow: "truncate" as const },
    };
    const measureAxis = { type: "value" as const, ...axisStyle(theme), axisLabel: { color: theme.muted, fontSize: 11, formatter: money ? compactInr : countFormat } };
    return {
      color: theme.palette.slice(0, Math.max(series.length, 1)),
      legend: series.length > 1 ? { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: theme.muted, fontSize: 11 } } : undefined,
      grid: { left: 8, right: horizontal ? 40 : 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
      tooltip: axisTooltip(theme, money),
      xAxis: horizontal ? measureAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : measureAxis,
      series: series.map((item) => ({
        name: item.name,
        type: "bar",
        stack: stacked ? "total" : undefined,
        barMaxWidth: 24,
        itemStyle: { borderRadius: stacked ? 2 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
        emphasis: { focus: "series" },
        data: item.values,
      })),
    };
  }, [categories, series, money, stacked, horizontal, dateAxis, theme]);
  if (!categories.length) return <EmptyChart height={height} />;
  return <EChart option={option} height={height} label={label} />;
}

/** Nightingale rose — share of a categorical total. */
export function RoseChart({
  data,
  label,
  money = false,
  height = 320,
}: {
  data: Array<{ name: string; value: number }>;
  label: string;
  money?: boolean;
  height?: number;
}) {
  const theme = useChartTheme();
  const option = useMemo<EChartsCoreOption>(() => {
    // Slivers below 4% get no leader line, otherwise their labels crowd the ring.
    const total = data.reduce((sum, row) => sum + row.value, 0) || 1;
    return {
      color: paletteFor(theme, data.length),
      tooltip: {
        ...baseTooltip(theme, "item"),
        formatter: (row: TooltipRow) => `${row.marker ?? ""} <b>${row.name}</b><br/>${valueFormat(money)(row.value)} (${row.percent?.toFixed(1)}%)`,
      },
      legend: { type: "scroll", bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: theme.muted, fontSize: 11 } },
      series: [
        {
          name: label,
          type: "pie",
          radius: [24, "68%"],
          center: ["50%", "45%"],
          roseType: "area",
          itemStyle: { borderRadius: 6, borderColor: theme.tooltipBg, borderWidth: 2 },
          label: { color: theme.muted, fontSize: 11, formatter: "{b}" },
          labelLine: { length: 8, length2: 8, lineStyle: { color: theme.border } },
          emphasis: { itemStyle: { shadowBlur: 12, shadowColor: `${theme.foreground}33` }, label: { color: theme.foreground, fontWeight: 600 } },
          data: [...data]
            .sort((a, b) => b.value - a.value)
            .map((row) => (row.value / total < 0.04 ? { ...row, label: { show: false }, labelLine: { show: false } } : row)),
        },
      ],
    };
  }, [data, label, money, theme]);
  if (!data.length) return <EmptyChart height={height} />;
  return <EChart option={option} height={height} label={label} />;
}

/** Horizontal bars with value labels — ranked categorical totals. */
export function RankedBarChart({
  data,
  label,
  money = false,
  height = 320,
}: {
  data: Array<{ name: string; value: number }>;
  label: string;
  money?: boolean;
  height?: number;
}) {
  const theme = useChartTheme();
  const option = useMemo<EChartsCoreOption>(() => {
    const rows = [...data].sort((a, b) => a.value - b.value);
    return {
      color: [theme.palette[1]],
      grid: { left: 8, right: 48, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(theme, "item"),
        formatter: (row: TooltipRow) => `${row.marker ?? ""} <b>${row.name}</b><br/>${valueFormat(money)(row.value)}`,
      },
      xAxis: { type: "value", ...axisStyle(theme), axisLabel: { color: theme.muted, fontSize: 11, formatter: money ? compactInr : countFormat } },
      yAxis: { type: "category", data: rows.map((row) => row.name), ...axisStyle(theme), splitLine: { show: false }, axisLabel: { color: theme.muted, fontSize: 11, width: 150, overflow: "truncate" } },
      series: [
        {
          name: label,
          type: "bar",
          barMaxWidth: 20,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          emphasis: { focus: "series" },
          label: { show: true, position: "right", color: theme.muted, fontSize: 11, formatter: ({ value }: { value: number }) => (money ? compactInr(value) : countFormat(value)) },
          data: rows.map((row) => row.value),
        },
      ],
    };
  }, [data, label, money, theme]);
  if (!data.length) return <EmptyChart height={height} />;
  return <EChart option={option} height={height} label={label} />;
}

/** Bars on a count axis with a smooth money line above them. */
export function ValueVolumeChart({
  dates,
  amounts,
  volumes,
  amountName,
  volumeName,
  label,
}: {
  dates: string[];
  amounts: number[];
  volumes: number[];
  amountName: string;
  volumeName: string;
  label: string;
}) {
  const theme = useChartTheme();
  const option = useMemo<EChartsCoreOption>(
    () => ({
      color: [theme.palette[2], theme.palette[0]],
      legend: { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: theme.muted, fontSize: 11 } },
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      tooltip: {
        ...baseTooltip(theme, "axis"),
        formatter: (rows: TooltipRow[]) =>
          `<div style="font-weight:600;margin-bottom:4px">${rows[0]?.name ?? ""}</div>${rows
            .map((row) => `${row.marker ?? ""} ${row.seriesName}: <b>${row.seriesName === amountName ? formatInr(row.value) : countFormat(row.value)}</b>`)
            .join("<br/>")}`,
      },
      xAxis: { type: "category", data: dates, ...axisStyle(theme), splitLine: { show: false }, axisLabel: { color: theme.muted, fontSize: 11, formatter: shortDate } },
      yAxis: [
        { type: "value", ...axisStyle(theme), axisLabel: { color: theme.muted, fontSize: 11, formatter: countFormat } },
        { type: "value", ...axisStyle(theme), splitLine: { show: false }, axisLabel: { color: theme.muted, fontSize: 11, formatter: compactInr } },
      ],
      series: [
        { name: volumeName, type: "bar", yAxisIndex: 0, barMaxWidth: 22, itemStyle: { borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" }, data: volumes },
        { name: amountName, type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, symbol: "circle", symbolSize: 7, lineStyle: { width: 3 }, emphasis: { focus: "series", scale: 1.4 }, data: amounts },
      ],
    }),
    [dates, amounts, volumes, amountName, volumeName, theme],
  );
  if (!dates.length) return <EmptyChart />;
  return <EChart option={option} label={label} />;
}
