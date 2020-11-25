import "./cluster-metrics.scss";

import React from "react";
import { observer } from "mobx-react";
import { ChartOptions, ChartPoint } from "chart.js";
import { clusterStore, MetricType } from "./cluster.store";
import { BarChart } from "../chart";
import { bytesToUnits } from "../../utils";
import { Spinner } from "../spinner";
import { ZebraStripes } from "../chart/zebra-stripes.plugin";
import { ClusterNoMetrics } from "./cluster-no-metrics";
import { ClusterMetricSwitchers } from "./cluster-metric-switchers";
import { getMetricLastPoints } from "../../api/endpoints/metrics.api";

export const ClusterMetrics = observer(() => {
  const { metricType, metricNodeRole, getMetricsValues, metricsLoaded, metrics, liveMetrics } = clusterStore;
  const { memoryCapacity, cpuCapacity } = getMetricLastPoints(clusterStore.metrics);
  const metricValues = getMetricsValues(metrics);
  const liveMetricValues = getMetricsValues(liveMetrics);
  const colors = { cpu: "#3D90CE", memory: "#C93DCE" };
  const data = metricValues.map(value => ({
    x: value[0],
    y: parseFloat(value[1]).toFixed(3)
  }));

  const datasets = [{
    id: metricType + metricNodeRole,
    label: metricType.toUpperCase() + " usage",
    borderColor: colors[metricType],
    data
  }];
  const cpuOptions: ChartOptions = {
    scales: {
      yAxes: [{
        ticks: {
          suggestedMax: cpuCapacity,
          callback: (value) => value
        }
      }]
    },
    tooltips: {
      callbacks: {
        label: ({ index }, data) => {
          const value = data.datasets[0].data[index] as ChartPoint;
          return value.y.toString();
        }
      }
    }
  };
  const memoryOptions: ChartOptions = {
    scales: {
      yAxes: [{
        ticks: {
          suggestedMax: memoryCapacity,
          callback: (value: string) => !value ? 0 : bytesToUnits(parseInt(value))
        }
      }]
    },
    tooltips: {
      callbacks: {
        label: ({ index }, data) => {
          const value = data.datasets[0].data[index] as ChartPoint;
          return bytesToUnits(parseInt(value.y as string), 3);
        }
      }
    }
  };
  const options = metricType === MetricType.CPU ? cpuOptions : memoryOptions;

  const renderMetrics = () => {
    if ((!metricValues.length || !liveMetricValues.length) && !metricsLoaded) {
      return <Spinner center/>;
    }
    if (!memoryCapacity || !cpuCapacity) {
      return <ClusterNoMetrics className="empty"/>;
    }
    return (
      <BarChart
        name={`${metricNodeRole}-${metricType}`}
        options={options}
        data={{ datasets }}
        timeLabelStep={5}
        showLegend={false}
        plugins={[ZebraStripes]}
      />
    );
  };

  return (
    <div className="ClusterMetrics flex column">
      <ClusterMetricSwitchers/>
      {renderMetrics()}
    </div>
  );
});