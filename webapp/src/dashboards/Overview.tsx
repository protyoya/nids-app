// SPDX-FileCopyrightText: (C) 2023 Jason Ish <jason@codemonkey.net>
// SPDX-License-Identifier: MIT

import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
} from "solid-js";
import { API, AggRequest } from "../api";
import { TIME_RANGE, Top } from "../Top";
import { Chart, ChartConfiguration } from "chart.js";
import { RefreshButton } from "../common/RefreshButton";
import { useSearchParams } from "@solidjs/router";
import { SensorSelect } from "../common/SensorSelect";
import { Colors } from "../common/colors";
import { getChartCanvasElement, loadingTracker } from "../util";
import { createStore } from "solid-js/store";
import { CountValueDataTable } from "../components/CountValueDataTable";
import dayjs from "dayjs";

interface AggResults {
  loading: boolean;
  rows: any[];
  timestamp: null | dayjs.Dayjs;
}

function defaultAggResults(): AggResults {
  return {
    loading: false,
    rows: [],
    timestamp: null,
  };
}

export function Overview() {
  const [version, setVersion] = createSignal(0);
  const [loading, setLoading] = createSignal(0);
  let histogram: any = undefined;
  let hiddenTypes: { [key: string]: boolean } = {
    anomaly: true,
    stats: true,
    netflow: true,
  };

  const [searchParams, setSearchParams] = useSearchParams<{
    sensor?: string;
  }>();

  const [topAlerts, setTopAlerts] =
    createStore<AggResults>(defaultAggResults());

  const [topDnsRequests, setTopDnsRequests] =
    createStore<AggResults>(defaultAggResults());

  const [topTlsSni, setTopTlsSni] =
    createStore<AggResults>(defaultAggResults());

  const [topQuicSni, setTopQuicSni] =
    createStore<AggResults>(defaultAggResults());

  const [topSourceIp, setTopSourceIp] =
    createStore<AggResults>(defaultAggResults());

  const [topDestIp, setTopDestIp] =
    createStore<AggResults>(defaultAggResults());

  const [topSourcePort, setTopSourcePort] =
    createStore<AggResults>(defaultAggResults());

  const [topDestPort, setTopDestPort] =
    createStore<AggResults>(defaultAggResults());

  const [eventsOverTimeLoading, setEventsOverTimeLoading] = createSignal(0);

  const [protocols, setProtocols] = createStore({
    loading: false,
    data: [],
  });
  let protocolsPieChartRef;

  function initChart() {
    if (histogram) {
      histogram.destroy();
    }
    buildChart();
  }

  onCleanup(() => {
    API.cancelAllSse();
  });

  createEffect(() => {
    refresh();
  });

  async function refresh() {
    setVersion((version) => version + 1);

    let q = "";
    if (searchParams.sensor) {
      q += `host:${searchParams.sensor}`;
    }

    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "alert.signature",
        size: 10,
        order: "desc",
        time_range: TIME_RANGE(),
        q: q + " event_type:alert",
      };

      setTopAlerts("loading", true);

      API.getSseAgg(request, version, (data: any) => {
        if (data === null) {
          setTopAlerts("loading", false);
        } else {
          const timestamp = dayjs(data.earliest_ts);
          setTopAlerts("timestamp", timestamp);
          setTopAlerts("rows", data.rows);
        }
      });
    });

    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "dns.rrname",
        size: 10,
        order: "desc",
        time_range: TIME_RANGE(),
        q: q + " event_type:dns dns.type:query",
      };

      setTopDnsRequests("loading", true);

      return API.getSseAgg(request, version, (data: any) => {
        if (data === null) {
          setTopDnsRequests("loading", false);
        } else {
          setTopDnsRequests("timestamp", dayjs(data.earliest_ts));
          setTopDnsRequests("rows", data.rows);
        }
      });
    });

    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "proto",
        size: 10,
        time_range: TIME_RANGE(),

        // Limit to flow types to get an accurate count, otherwise
        // we'll get duplicate counts from different event types.
        q: q + " event_type:flow",
      };

      setProtocols("loading", true);
      setProtocols("data", []);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          if (protocols.data.length == 0) {
            console.log("SSE request for flow protos: first response");
            setProtocols("data", data.rows);
          } else {
            console.log("SSE request for flow protos: subsequent response");
            let labels = data.rows.map((e: any) => e.key);
            let dataset = data.rows.map((e: any) => e.count);
            let chart: any = Chart.getChart(protocolsPieChartRef!);
            chart.data.labels = labels;
            chart.data.datasets[0].data = dataset;
            chart.data.datasets[0].backgroundColor = dataset.map(
              (_, i) => Colors[i % Colors.length],
            );
            chart.data.datasets[0].borderColor = dataset.map(
              (_, i) => Colors[i % Colors.length],
            );
            chart.update();
          }
        } else {
          console.log("SSE request for flow protos done.");
        }
      }).finally(() => {
        setProtocols("loading", false);
      });
    });

    // TLS SNI.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "tls.sni",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:tls",
      };

      setTopTlsSni("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopTlsSni("timestamp", dayjs(data.earliest_ts));
          setTopTlsSni("rows", data.rows);
        }
      }).finally(() => {
        setTopTlsSni("loading", false);
      });
    });

    // Quic SNI.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "quic.sni",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:quic",
      };
      setTopQuicSni("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopQuicSni("timestamp", dayjs(data.earliest_ts));
          setTopQuicSni("rows", data.rows);
        }
      }).finally(() => {
        setTopQuicSni("loading", false);
      });
    });

    // Top Source IP.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "src_ip",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:flow",
      };
      setTopSourceIp("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopSourceIp("timestamp", dayjs(data.earliest_ts));
          setTopSourceIp("rows", data.rows);
        }
      }).finally(() => {
        setTopSourceIp("loading", false);
      });
    });

    // Top Destination IP.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "dest_ip",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:flow",
      };
      setTopDestIp("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopDestIp("timestamp", dayjs(data.earliest_ts));
          setTopDestIp("rows", data.rows);
        }
      }).finally(() => {
        setTopDestIp("loading", false);
      });
    });

    // Top Source Port.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "src_port",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:flow",
      };
      setTopSourcePort("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopSourcePort("timestamp", dayjs(data.earliest_ts));
          setTopSourcePort("rows", data.rows);
        }
      }).finally(() => {
        setTopSourcePort("loading", false);
      });
    });

    // Top Destination Port.
    loadingTracker(setLoading, async () => {
      let request: AggRequest = {
        field: "dest_port",
        size: 10,
        time_range: TIME_RANGE(),
        q: q + " event_type:flow",
      };
      setTopDestPort("loading", true);

      return await API.getSseAgg(request, version, (data: any) => {
        if (data) {
          setTopDestPort("timestamp", dayjs(data.earliest_ts));
          setTopDestPort("rows", data.rows);
        }
      }).finally(() => {
        setTopDestPort("loading", false);
      });
    });

    fetchEventsHistogram(q);
  }

  async function fetchEventsHistogram(q: string) {
    initChart();

    let eventTypes = await API.getEventTypes({
      time_range: TIME_RANGE(),
    });

    let labels: number[] = [];

    for (const row of eventTypes) {
      let request = {
        time_range: TIME_RANGE(),
        event_type: row,
        query_string: q,
      };

      loadingTracker(setLoading, async () => {
        setEventsOverTimeLoading((v) => v + 1);
        let response = await API.histogramTime(request);
        if (labels.length === 0) {
          response.data.forEach((e) => {
            labels.push(e.time);
          });
          histogram.data.labels = labels;
        }

        if (response.data.length != labels.length) {
          console.log("ERROR: Label and data mismatch");
        } else {
          let values = response.data.map((e) => e.count);
          let hidden = hiddenTypes[row];
          let colorIdx = histogram.data.datasets.length;
          histogram.data.datasets.push({
            data: values,
            label: row,
            pointRadius: 0,
            hidden: hidden,
            backgroundColor: Colors[colorIdx % Colors.length],
            borderColor: Colors[colorIdx % Colors.length],
          });
          histogram.update();
        }
      }).finally(() => {
        setEventsOverTimeLoading((v) => v - 1);
      });
    }
  }

  function buildChart() {
    const ctx = getChartCanvasElement("histogram");

    const config: ChartConfiguration | any = {
      type: "bar",
      data: {
        labels: [],
        datasets: [],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          title: {
            display: false,
            padding: 0,
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function (context: any) {
                let label = context.dataset.label;
                let value = context.parsed.y;
                if (value == 0) {
                  return null;
                }
                return `${label}: ${value}`;
              },
            },
            // Sort items in descending order.
            itemSort: function (a: any, b: any) {
              return b.raw - a.raw;
            },
            // Limit the tooltip to the top 5 items. Like default Kibana.
            filter: function (item: any, _data: any) {
              return item.datasetIndex < 6;
            },
          },
          legend: {
            display: true,
            position: "top",
            onClick: (_e: any, legendItem: any, legend: any) => {
              const eventType = legendItem.text;
              const index = legendItem.datasetIndex;
              const ci = legend.chart;
              if (ci.isDatasetVisible(index)) {
                ci.hide(index);
                legendItem.hidden = true;
                hiddenTypes[eventType] = true;
              } else {
                ci.show(index);
                legendItem.hidden = false;
                hiddenTypes[eventType] = false;
              }
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "nearest",
          axis: "x",
        },
        elements: {
          line: {
            tension: 0.4,
          },
        },
        scales: {
          x: {
            type: "time",
            ticks: {
              source: "auto",
            },
            stacked: true,
          },
          y: {
            display: true,
          },
        },
      },
    };
    if (histogram) {
      histogram.destroy();
    }
    histogram = new Chart(ctx, config);
  }

  const formatSuffix = (timestamp: dayjs.Dayjs | null) => {
    if (timestamp) {
      return `since ${timestamp.fromNow()}`;
    }
    return undefined;
  };

  return (
    <>
      <Top />
      <div style="padding: 0 1.5rem 2rem;">
        {/* Debug. */}
        <Show when={localStorage.getItem("DEBUG") !== null}>
          {JSON.stringify(
            {
              "eventStore.events.length": eventStore.events.length,
              "eventStore.active._id": eventStore.active?._id || null,
              "eventStore.viewOffset": eventStore.viewOffset,
              "eventStore.cursor": eventStore.cursor,
            },
            null,
            1,
          )}
        </Show>

        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
          <RefreshButton loading={loading()} refresh={refresh} />
          <SensorSelect
            selected={searchParams.sensor}
            onchange={(sensor) => {
              setSearchParams({ sensor: sensor });
            }}
          />
        </div>

        <div style="
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
          gap: 1.25rem;
        ">

          <div class="bento-card" style="grid-column: 1 / -1;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <p class="bento-card-title">Events by Type Over Time</p>
              <Show when={eventsOverTimeLoading() > 0}>
                <span class="spinner-border spinner-border-sm text-muted" aria-hidden="true"></span>
              </Show>
            </div>
            <div class="bento-chart-wrap" style="height: 180px;">
              <canvas id="histogram"></canvas>
            </div>
          </div>

          <div class="bento-card flex flex-col" style="height: 100%;">
            <div style="padding-bottom: 0;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <p class="bento-card-title" style="margin-bottom: 0.25rem;">Protocols</p>
                  <p style="font-size: 0.875rem; color: #a1a1aa; margin: 0;">Traffic distribution by protocol</p>
                </div>
                <Show when={protocols.loading !== undefined && protocols.loading}>
                  <span class="spinner-border spinner-border-sm text-muted" aria-hidden="true"></span>
                </Show>
              </div>
            </div>
            <div class="bento-chart-wrap" style="flex: 1; display: flex; justify-content: center; align-items: center; min-height: 220px; padding-top: 1rem;">
              <PieChart data={protocols.data} ref={protocolsPieChartRef} />
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.875rem; margin-top: 1rem; border-top: 1px solid #27272a; padding-top: 1rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 500; line-height: 1;">
                Trending up by 5.2% this month
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
                  <polyline points="16 7 22 7 22 13"></polyline>
                </svg>
              </div>
              <div style="line-height: 1; color: #a1a1aa;">
                Showing protocol distribution for the recorded window
              </div>
            </div>
          </div>

          <CountValueDataTable
            title="Top Alerts"
            label="Signature"
            rows={topAlerts.rows}
            loading={topAlerts.loading}
            searchField="alert.signature"
            suffix={formatSuffix(topAlerts.timestamp)}
          />
          <CountValueDataTable
            title="Top DNS Requests"
            label="Hostname"
            rows={topDnsRequests.rows}
            loading={topDnsRequests.loading}
            searchField="dns.rrname"
            suffix={formatSuffix(topDnsRequests.timestamp)}
          />

          <CountValueDataTable
            title="Top TLS SNI"
            label="Hostname"
            rows={topTlsSni.rows}
            loading={topTlsSni.loading}
            searchField="tls.sni"
            suffix={formatSuffix(topTlsSni.timestamp)}
          />
          <CountValueDataTable
            title="Top Quic SNI"
            label="Hostname"
            rows={topQuicSni.rows}
            loading={topQuicSni.loading}
            searchField="quic.sni"
            suffix={formatSuffix(topQuicSni.timestamp)}
          />

          <CountValueDataTable
            title="Top Source IP Addresses"
            label="IP Address"
            rows={topSourceIp.rows}
            loading={topSourceIp.loading}
            searchField="src_ip"
            suffix={formatSuffix(topSourceIp.timestamp)}
            tooltip="Based on flow events"
          />
          <CountValueDataTable
            title="Top Destination IP Addresses"
            label="IP Address"
            rows={topDestIp.rows}
            loading={topDestIp.loading}
            searchField="dest_ip"
            suffix={formatSuffix(topDestIp.timestamp)}
            tooltip="Based on flow events"
          />

          <CountValueDataTable
            title="Top Source Ports"
            label="Port"
            rows={topSourcePort.rows}
            loading={topSourcePort.loading}
            searchField="src_port"
            suffix={formatSuffix(topSourcePort.timestamp)}
            tooltip="Based on flow events"
          />
          <CountValueDataTable
            title="Top Destination Ports"
            label="Port"
            rows={topDestPort.rows}
            loading={topDestPort.loading}
            searchField="dest_port"
            suffix={formatSuffix(topDestPort.timestamp)}
            tooltip="Based on flow events"
          />
        </div>
      </div>
    </>
  );
}

function PieChart(props: { data: any[]; ref?: any }) {
  const chartId = createUniqueId();
  let chart: any = null;

  createEffect(() => {
    const element = getChartCanvasElement(chartId);

    if (chart != null) {
      chart.destroy();
    }

    const shadcnBlueColors = [
      "#2563eb", // blue-600
      "#3b82f6", // blue-500
      "#60a5fa", // blue-400
      "#93c5fd", // blue-300
      "#bfdbfe", // blue-200
    ];

    chart = new Chart(element, {
      type: "pie",
      data: {
        labels: props.data.map((e) => e.key),
        datasets: [
          {
            data: props.data.map((e) => e.count),
            backgroundColor: props.data.map(
              (_, i) => shadcnBlueColors[i % shadcnBlueColors.length],
            ),
            borderColor: "rgba(24, 24, 27, 1)", // matches bento-card bg
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: 10,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: "#18181b",
            titleColor: "#fafafa",
            bodyColor: "#fafafa",
            borderColor: "#27272a",
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            boxPadding: 4,
          },
        },
      },
    });
  });

  return (
    <>
      <canvas ref={props.ref} id={chartId}></canvas>
    </>
  );
}
