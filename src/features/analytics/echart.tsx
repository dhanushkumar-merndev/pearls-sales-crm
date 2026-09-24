"use client";

import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import { Skeleton } from "@/components/ui/skeleton";

let registered: Promise<typeof import("echarts/core")> | null = null;

/** Loads the tree-shaken ECharts bundle once, on the client only. */
function loadECharts() {
  registered ??= (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]);
    core.use([
      charts.LineChart,
      charts.BarChart,
      charts.PieChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.DatasetComponent,
      components.DataZoomComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  })();
  return registered;
}

/**
 * Thin React binding for ECharts: initialises once, re-applies the option on
 * change, resizes with its container and disposes on unmount.
 */
export function EChart({
  option,
  height = 288,
  className,
  label,
}: {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<ECharts | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void loadECharts().then((echarts) => {
      if (disposed || !container.current) return;
      instance.current = echarts.init(container.current, undefined, { renderer: "canvas" });
      observer = new ResizeObserver(() => instance.current?.resize());
      observer.observe(container.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready) instance.current?.setOption(option, true);
  }, [option, ready]);

  return (
    <div className={className} style={{ height }} role="img" aria-label={label}>
      {!ready && <Skeleton className="h-full w-full" />}
      <div ref={container} className="h-full w-full" style={{ visibility: ready ? "visible" : "hidden" }} />
    </div>
  );
}

const fallback = ["#a87a30", "#2a78d6", "#199e70", "#4a3aa7", "#d55181"];
let probe: CanvasRenderingContext2D | null = null;

/**
 * Resolves a theme token to `#rrggbb` by painting it once. Tokens are authored
 * in `oklch()`, which canvas normalises to `lab()` — a form ECharts cannot use
 * for gradients or `${color}alpha` suffixes, so the pixel value is read back.
 */
function cssColor(token: string, index: number) {
  if (typeof window === "undefined") return fallback[index % fallback.length];
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!raw) return fallback[index % fallback.length];
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback[index % fallback.length];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000000";
  probe.fillStyle = raw;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (a === 0) return fallback[index % fallback.length];
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export type ChartTheme = {
  palette: string[];
  foreground: string;
  muted: string;
  border: string;
  tooltipBg: string;
};

const serverTheme: ChartTheme = { palette: fallback, foreground: "#2c1a0e", muted: "#7a6550", border: "#eae1d1", tooltipBg: "#ffffff" };
const themeCache = new Map<string, ChartTheme>();

/**
 * Reads the shadcn theme tokens so ECharts follows the app palette. Resolved
 * once per document theme class and cached, keeping the object identity stable
 * for the `useMemo` option builders.
 */
export function useChartTheme(): ChartTheme {
  if (typeof window === "undefined") return serverTheme;
  const key = document.documentElement.className;
  const cached = themeCache.get(key);
  if (cached) return cached;
  const theme: ChartTheme = {
    palette: ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"].map(cssColor),
    foreground: cssColor("--foreground", 0),
    muted: cssColor("--muted-foreground", 0),
    border: cssColor("--border", 0),
    tooltipBg: cssColor("--popover", 0),
  };
  themeCache.set(key, theme);
  return theme;
}

/** Cycles the five theme chart colours for series with more categories. */
export function paletteFor(theme: ChartTheme, count: number) {
  return Array.from({ length: count }, (_, index) => theme.palette[index % theme.palette.length]);
}
