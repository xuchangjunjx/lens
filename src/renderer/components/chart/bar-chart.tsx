import React from "react";
import merge from "lodash/merge";
import moment from "moment";
import Color from "color";
import { observer } from "mobx-react";
import { ChartData, ChartOptions, ChartPoint, Scriptable } from "chart.js";
import { Chart, ChartKind, ChartProps } from "./chart";
import { bytesToUnits, cssNames } from "../../utils";
import { ZebraStripes } from "./zebra-stripes.plugin";
import { themeStore } from "../../theme.store";
import { NoMetrics } from "../resource-metrics/no-metrics";

interface Props extends ChartProps {
  name?: string;
  timeLabelStep?: number;  // Minute labels appearance step
}

const defaultProps: Partial<Props> = {
  timeLabelStep: 10,
  plugins: [ZebraStripes]
};

@observer
export class BarChart extends React.Component<Props> {
  static defaultProps = defaultProps as object;

  render() {
    const { name, data, className, timeLabelStep, plugins, options: customOptions, ...settings } = this.props;
    const { textColorPrimary, borderFaintColor, chartStripesColor } = themeStore.activeTheme.colors;

    const getBarColor: Scriptable<string> = ({ dataset }) => {
      const color = dataset.borderColor;
      return Color(color).alpha(0.2).string();
    };

    // Remove empty sets and insert default data
    const chartData: ChartData = {
      ...data,
      datasets: data.datasets
        .filter(set => set.data.length)
        .map(item => {
          return {
            type: ChartKind.BAR,
            borderWidth: { top: 3 },
            barPercentage: 1,
            categoryPercentage: 1,
            ...item
          };
        })
    };

    const formatTimeLabels = (timestamp: string, index: number) => {
      const label = moment(parseInt(timestamp)).format("HH:mm");
      const offset = "     ";
      if (index == 0) return offset + label;
      if (index == 60) return label + offset;
      return index % timeLabelStep == 0 ? label : "";
    };

    const barOptions: ChartOptions = {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        xAxes: [{
          type: "time",
          offset: true,
          gridLines: {
            display: false,
          },
          stacked: true,
          ticks: {
            callback: formatTimeLabels,
            autoSkip: false,
            source: "data",
            backdropColor: "white",
            fontColor: textColorPrimary,
            fontSize: 11,
            maxRotation: 0,
            minRotation: 0
          },
          bounds: "data",
          time: {
            unit: "minute",
            displayFormats: {
              minute: "x"
            },
            parser: timestamp => moment.unix(parseInt(timestamp))
          }
        }],
        yAxes: [{
          position: "right",
          gridLines: {
            color: borderFaintColor,
            drawBorder: false,
            tickMarkLength: 0,
            zeroLineWidth: 0
          },
          ticks: {
            maxTicksLimit: 6,
            fontColor: textColorPrimary,
            fontSize: 11,
            padding: 8,
            min: 0
          }
        }]
      },
      tooltips: {
        mode: "index",
        position: "cursor",
        callbacks: {
          title: tooltipItems => {
            const now = new Date().getTime();
            if (new Date(tooltipItems[0].xLabel).getTime() > now) return "";
            return `${tooltipItems[0].xLabel}`;
          },
          labelColor: ({ datasetIndex }) => {
            return {
              borderColor: "darkgray",
              backgroundColor: chartData.datasets[datasetIndex].borderColor as string
            };
          }
        }
      },
      animation: {
        duration: 0
      },
      elements: {
        rectangle: {
          backgroundColor: getBarColor.bind(null)
        }
      },
      plugins: {
        ZebraStripes: {
          stripeColor: chartStripesColor
        }
      }
    };
    const options = merge(barOptions, customOptions);
    if (chartData.datasets.length == 0) {
      return <NoMetrics/>;
    }
    return (
      <Chart
        className={cssNames("BarChart flex box grow column", className)}
        type={ChartKind.BAR}
        data={chartData}
        options={options}
        plugins={plugins}
        {...settings}
      />
    );
  }
}

// Default options for all charts containing memory units (network, disk, memory, etc)
export const memoryOptions: ChartOptions = {
  scales: {
    yAxes: [{
      ticks: {
        callback: (value: number | string): string => {
          if (typeof value == "string") {
            const float = parseFloat(value);
            if (float < 1) {
              return float.toFixed(3);
            }
            return bytesToUnits(parseInt(value));
          }
          return bytesToUnits(value);
        },
        stepSize: 1
      }
    }]
  },
  tooltips: {
    callbacks: {
      label: ({ datasetIndex, index }, { datasets }) => {
        const { label, data } = datasets[datasetIndex];
        const value = data[index] as ChartPoint;
        return `${label}: ${bytesToUnits(parseInt(value.y.toString()), 3)}`;
      }
    }
  }
};

// Default options for all charts with cpu units or other decimal numbers
export const cpuOptions: ChartOptions = {
  scales: {
    yAxes: [{
      ticks: {
        callback: (value: number | string): string => {
          const float = parseFloat(`${value}`);
          if (float == 0) return "0";
          if (float < 10) return float.toFixed(3);
          if (float < 100) return float.toFixed(2);
          return float.toFixed(1);
        }
      }
    }]
  },
  tooltips: {
    callbacks: {
      label: ({ datasetIndex, index }, { datasets }) => {
        const { label, data } = datasets[datasetIndex];
        const value = data[index] as ChartPoint;
        return `${label}: ${parseFloat(value.y as string).toPrecision(2)}`;
      }
    }
  }
};