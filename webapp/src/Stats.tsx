// SPDX-FileCopyrightText: (C) 2023 Jason Ish <jason@codemonkey.net>
// SPDX-License-Identifier: MIT

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Top, TIME_RANGE, SET_TIME_RANGE } from "./Top";
import { timeRangeAsSeconds } from "./settings";
import { statsAggBySensor } from "./api";
import { Chart } from "chart.js";
import { parse_timestamp } from "./datetime";
import dayjs from "dayjs";
import { useSearchParams } from "@solidjs/router";
import { SensorSelect } from "./common/SensorSelect";
import { RefreshButton } from "./common/RefreshButton";
import { loadingTracker } from "./util";

interface ChartConfig {
  title: string;
  field: string;
  differential: boolean;
  canvasId: string;
}

const CHARTS: ChartConfig[] = [
  {
    title: "Decoder Bytes",
    field: "stats.decoder.bytes",
    differential: true,
    canvasId: "decoderBytes",
  },
  {
    title: "Decoder Packets",
    field: "stats.decoder.pkts",
    differential: true,
    canvasId: "decoderPackets",
  },
  {
    title: "Kernel Drops",
    field: "stats.capture.kernel_drops",
    differential: true,
    canvasId: "kernelDrops",
  },
  {
    title: "Flow Active",
    field: "stats.flow.active",
    differential: false,
    canvasId: "flowActive",
  },
  {
    title: "Flow Total",
    field: "stats.flow.total",
    differential: true,
    canvasId: "flowTotal",
  },
  {
    title: "Flow Spare",
    field: "stats.flow.spare",
    differential: false,
    canvasId: "flowSpare",
  },
  {
    title: "Flow Memory",
    field: "stats.flow.memuse",
    differential: false,
    canvasId: "flowMemuse",
  },
  {
    title: "TCP Memory",
    field: "stats.tcp.memuse",
    differential: false,
    canvasId: "tcpMemuse",
  },
  {
    title: "TCP Reassembly Memory",
    field: "stats.tcp.reassembly_memuse",
    differential: false,
    canvasId: "tcpReassemblyMemuse",
  },
];

// Define a color palette — vivid accent colours that look great with gradient fills
const SENSOR_COLORS = [
  { solidStart: "rgba(99, 179, 237, 1)",   solidEnd: "rgba(99, 179, 237, 0)" },   // sky
  { solidStart: "rgba(154, 230, 180, 1)",  solidEnd: "rgba(154, 230, 180, 0)" },  // green
  { solidStart: "rgba(252, 196, 25, 1)",   solidEnd: "rgba(252, 196, 25, 0)" },   // amber
  { solidStart: "rgba(248, 113, 113, 1)",  solidEnd: "rgba(248, 113, 113, 0)" },  // rose
  { solidStart: "rgba(167, 139, 250, 1)",  solidEnd: "rgba(167, 139, 250, 0)" },  // violet
  { solidStart: "rgba(251, 146, 60, 1)",   solidEnd: "rgba(251, 146, 60, 0)" },   // orange
  { solidStart: "rgba(52, 211, 153, 1)",   solidEnd: "rgba(52, 211, 153, 0)" },   // emerald
  { solidStart: "rgba(232, 121, 249, 1)",  solidEnd: "rgba(232, 121, 249, 0)" },  // fuchsia
  { solidStart: "rgba(125, 211, 252, 1)",  solidEnd: "rgba(125, 211, 252, 0)" },  // cyan
  { solidStart: "rgba(253, 186, 116, 1)",  solidEnd: "rgba(253, 186, 116, 0)" },  // peach
];

export function Stats(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams<{
    sensor: string;
    min_timestamp: string;
    max_timestamp: string;
  }>();
  const [loadingCounter, setLoadingCounter] = createSignal(0);
  const [timeRange, setTimeRange] = createSignal<{
    min: string;
    max: string;
  } | null>(null);

  let charts: any[] = [];

  // Function to update all charts (for crosshair sync)
  function updateAllCharts() {
    charts.forEach((chart) => chart.update("none"));
  }

  // Make it available globally for the buildChart function
  (window as any).updateAllCharts = updateAllCharts;

  // Enforce max 7-day time range for stats page
  onMount(() => {
    if (TIME_RANGE() === "") {
      SET_TIME_RANGE("7d");
    }
  });

  onCleanup(() => {
    destroyAllCharts();
  });

  // React to URL parameter changes and time range changes
  createEffect(() => {
    // Track these reactive values to trigger re-render
    const sensor = searchParams.sensor;
    const minTs = searchParams.min_timestamp;
    const maxTs = searchParams.max_timestamp;
    const tr = TIME_RANGE();

    refresh();
  });

  // Clear timestamps when time range selector changes
  let previousTimeRange: string | undefined;
  createEffect(() => {
    const currentTimeRange = TIME_RANGE();

    // If time range changed and we had a previous value, clear timestamps
    if (
      previousTimeRange !== undefined &&
      previousTimeRange !== currentTimeRange
    ) {
      setSearchParams({
        min_timestamp: undefined,
        max_timestamp: undefined,
      });
    }

    previousTimeRange = currentTimeRange;
  });

  function destroyAllCharts() {
    console.log("Destroying charts...");
    while (charts.length > 0) {
      const chart = charts.pop();
      chart.destroy();
    }
  }

  // Use createMemo for computed values that depend on reactive state
  const timeWindow = createMemo<{ min: string; max: string } | null>(() => {
    const timeRangeSeconds = timeRangeAsSeconds();
    if (!timeRangeSeconds) return null;

    // If URL has timestamps, use them
    if (searchParams.min_timestamp && searchParams.max_timestamp) {
      return {
        min: searchParams.min_timestamp,
        max: searchParams.max_timestamp,
      };
    }

    // Otherwise calculate current time window based on NOW
    const now = dayjs();
    const startTime = now.subtract(timeRangeSeconds, "second");

    return {
      min: startTime.utc().toISOString(),
      max: now.utc().toISOString(),
    };
  });

  // Simplified navigation functions
  function navigateToPrevious() {
    const tw = timeWindow();
    if (!tw) return;

    const timeRangeSeconds = timeRangeAsSeconds();
    if (!timeRangeSeconds) return;

    // Move window back by one time range
    const minDate = dayjs(tw.min).subtract(timeRangeSeconds, "second");
    const maxDate = dayjs(tw.max).subtract(timeRangeSeconds, "second");

    setSearchParams({
      min_timestamp: minDate.utc().toISOString(),
      max_timestamp: maxDate.utc().toISOString(),
    });
  }

  function navigateToNext() {
    const tw = timeWindow();
    if (!tw) return;

    const timeRangeSeconds = timeRangeAsSeconds();
    if (!timeRangeSeconds) return;

    // Move window forward by one time range
    const minDate = dayjs(tw.min).add(timeRangeSeconds, "second");
    const maxDate = dayjs(tw.max).add(timeRangeSeconds, "second");

    setSearchParams({
      min_timestamp: minDate.utc().toISOString(),
      max_timestamp: maxDate.utc().toISOString(),
    });
  }

  function navigateToNow() {
    // Clear timestamps to show current time window
    setSearchParams({ min_timestamp: undefined, max_timestamp: undefined });
  }

  // Memoized computed values for button states
  const isViewingCurrentTime = createMemo(() => {
    return !searchParams.min_timestamp && !searchParams.max_timestamp;
  });

  const canNavigateNext = createMemo(() => {
    // Can't navigate next if we're already at current time
    if (isViewingCurrentTime()) return false;

    // Can navigate next if we have timestamps and max is in the past
    const tw = timeWindow();
    if (tw && tw.max) {
      const maxDate = dayjs(tw.max);
      const now = dayjs();
      // Allow navigation if the window's max time is before now
      return maxDate.isBefore(now);
    }

    return false;
  });

  function refresh() {
    const tw = timeWindow();
    loadData(searchParams.sensor, tw);
  }

  function loadData(
    selectedSensor: string | undefined,
    timeWindow: { min: string; max: string } | null,
  ) {
    destroyAllCharts();

    console.log("Loading charts...");

    for (let i = 0; i < CHARTS.length; i++) {
      const chart = CHARTS[i];
      loadingTracker(setLoadingCounter, () => {
        return statsAggBySensor(
          chart.field,
          chart.differential,
          timeWindow?.min,
          timeWindow?.max,
        ).then((response) => {
          // Capture time range from first response
          if (i === 0 && response.min_timestamp && response.max_timestamp) {
            setTimeRange({
              min: response.min_timestamp,
              max: response.max_timestamp,
            });
          }

          // Build datasets for each sensor
          const datasets: any[] = [];
          let allTimestamps = new Set<string>();

          // Filter data if a specific sensor is selected
          let filteredData = response.data;
          if (selectedSensor) {
            // Handle both regular sensor names and "(no-name)"
            filteredData = Object.fromEntries(
              Object.entries(response.data).filter(
                ([sensor]) => sensor === selectedSensor,
              ),
            );
          }

          // First, collect all unique timestamps
          Object.entries(filteredData).forEach(([sensor, dataPoints]) => {
            dataPoints.forEach((dp) => {
              allTimestamps.add(dp.timestamp);
            });
          });

          // Sort timestamps
          const sortedTimestamps = Array.from(allTimestamps).sort();
          const labels = sortedTimestamps.map((ts) =>
            parse_timestamp(ts).toDate(),
          );

          // Create a dataset for each sensor
          let colorIndex = 0;
          Object.entries(filteredData).forEach(([sensor, dataPoints]) => {
            const color = SENSOR_COLORS[colorIndex % SENSOR_COLORS.length];
            colorIndex++;

            // Create a map for quick lookup
            const valueMap = new Map<string, number>();
            dataPoints.forEach((dp) => {
              valueMap.set(dp.timestamp, dp.value);
            });

            // Build values array aligned with all timestamps
            const values = sortedTimestamps.map((ts) => {
              return valueMap.get(ts) || 0;
            });

            datasets.push({
              label: sensor,
              data: values,
              // Gradient fill is applied inside buildChart via canvas API
              _colorDef: color,
              backgroundColor: "transparent", // placeholder — overwritten after chart init
              borderColor: color.solidStart,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: color.solidStart,
              fill: true,
              borderWidth: 2,
              tension: 0.4,
            });
          });

          const canvas = buildChart(
            chart.canvasId,
            chart.title,
            labels,
            datasets,
          );
          charts.push(canvas);
        });
      });
    }
  }

  return (
    <div>
      <Top excludeTimeRanges={[""]} />
      <div style="padding: 0 1.5rem 2rem;">
        {/* Controls row */}
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
          <RefreshButton loading={loadingCounter()} refresh={refresh} />
          <SensorSelect
            selected={searchParams.sensor}
            onchange={(sensor) => {
              setSearchParams({ sensor: sensor });
            }}
          />
          <Show when={timeRange()}>
            <div style="margin-left: auto; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <span style="font-size: 0.8rem; color: #71717a;">
                {parse_timestamp(timeRange()!.min).format("YYYY-MM-DD HH:mm")}
                {" — "}
                {parse_timestamp(timeRange()!.max).format("YYYY-MM-DD HH:mm")}
              </span>
              <div class="btn-group">
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={navigateToPrevious}>&larr; Prev</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={navigateToNext} disabled={!canNavigateNext()}>Next &rarr;</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={navigateToNow} disabled={isViewingCurrentTime()}>Now</button>
              </div>
            </div>
          </Show>
        </div>

        {/* Bento grid */}
        <div style="
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
          gap: 1.25rem;
        ">
          <For each={CHARTS}>
            {(chart) => (
              <div class="bento-card">
                <p class="bento-card-title">{chart.title}</p>
                <div class="bento-chart-wrap">
                  <canvas id={chart.canvasId}></canvas>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function buildChart(
  elementId: string,
  title: string,
  labels: Date[],
  datasets: any[],
): Chart<any> {
  const canvas = document.getElementById(elementId) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // Build canvas gradient fills for each dataset
  const styledDatasets = datasets.map((ds) => {
    const color = ds._colorDef;
    // Gradient from top (opaque) to bottom (transparent)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 220);
    gradient.addColorStop(0, color.solidStart.replace(", 1)", ", 0.35)"));
    gradient.addColorStop(1, color.solidEnd);
    return {
      ...ds,
      backgroundColor: gradient,
    };
  });

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: styledDatasets,
    },
    options: {
      interaction: {
        intersect: false,
        mode: "index",
      },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          grid: {
            color: "rgba(255,255,255,0.05)",
            drawBorder: false,
          } as any,
          ticks: {
            color: "#71717a",
            font: { size: 11, family: "'Inter', system-ui, sans-serif" },
            maxTicksLimit: 8,
          },
          border: { display: false },
        },
        y: {
          grid: {
            color: "rgba(255,255,255,0.05)",
            drawBorder: false,
          } as any,
          ticks: {
            color: "#71717a",
            font: { size: 11, family: "'Inter', system-ui, sans-serif" },
          },
          afterFit: (scaleInstance) => {
            scaleInstance.width = 80;
          },
          border: { display: false },
        },
      },
      plugins: {
        title: { display: false },  // title shown via bento-card-title
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: {
            color: "#a1a1aa",
            font: { size: 11, family: "'Inter', system-ui, sans-serif" },
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            padding: 12,
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(17,17,19,0.95)",
          borderColor: "#3f3f46",
          borderWidth: 1,
          titleColor: "#fafafa",
          bodyColor: "#a1a1aa",
          titleFont: { size: 12, weight: "600", family: "'Inter', system-ui, sans-serif" },
          bodyFont: { size: 11, family: "'Inter', system-ui, sans-serif" },
          padding: 10,
          cornerRadius: 8,
        },
      },
      onHover: (event, activeElements, chart) => {
        if (event.native) {
          const rect = (
            event.native.target as HTMLCanvasElement
          ).getBoundingClientRect();
          const x = (event.native as MouseEvent).clientX - rect.left;
          const y = (event.native as MouseEvent).clientY - rect.top;

          if (
            x >= chart.chartArea.left &&
            x <= chart.chartArea.right &&
            y >= chart.chartArea.top &&
            y <= chart.chartArea.bottom
          ) {
            crosshairX = x;
            if ((window as any).updateAllCharts) {
              (window as any).updateAllCharts();
            }
          }
        }
      },
    },
  });

  // Handle mouse leave to clear crosshair
  ctx.canvas.addEventListener("mouseleave", () => {
    crosshairX = null;
    if ((window as any).updateAllCharts) {
      (window as any).updateAllCharts();
    }
  });

  return chart;
}

// Shared state for crosshair position across all charts
let crosshairX: number | null = null;

// Custom plugin to draw vertical crosshair line
const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chart: Chart) {
    if (crosshairX !== null) {
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(crosshairX, chartArea.top);
      ctx.lineTo(crosshairX, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.stroke();
      ctx.restore();
    }
  },
};

// Register the plugin
Chart.register(crosshairPlugin);
