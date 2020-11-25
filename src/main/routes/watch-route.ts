import { LensApiRequest } from "../router";
import { LensApi } from "../lens-api";
import { Watch, KubeConfig } from "@kubernetes/client-node";
import { ServerResponse } from "http";
import { Request } from "request";
import logger from "../logger";

class ApiWatcher {
  private apiUrl: string;
  private response: ServerResponse;
  private watchRequest: Request;
  private watch: Watch;
  private processor: NodeJS.Timeout;
  private eventBuffer: any[] = [];

  constructor(apiUrl: string, kubeConfig: KubeConfig, response: ServerResponse) {
    this.apiUrl = apiUrl;
    this.watch = new Watch(kubeConfig);
    this.response = response;
  }

  public async start() {
    if (this.processor) {
      clearInterval(this.processor);
    }
    this.processor = setInterval(() => {
      const events = this.eventBuffer.splice(0);
      events.map(event => this.sendEvent(event));
      this.response.flushHeaders();
    }, 50);
    this.watchRequest = await this.watch.watch(this.apiUrl, {}, this.watchHandler.bind(this), this.doneHandler.bind(this));
  }

  public stop() {
    if (!this.watchRequest) { return; }

    if (this.processor) {
      clearInterval(this.processor);
    }
    logger.debug("Stopping watcher for api: " + this.apiUrl);
    try {
      this.watchRequest.abort();
      this.sendEvent({
        type: "STREAM_END",
        url: this.apiUrl,
        status: 410,
      });
      logger.debug("watch aborted");
    } catch (error) {
      logger.error("Watch abort errored:" + error);
    }
  }

  private watchHandler(phase: string, obj: any) {
    this.eventBuffer.push({
      type: phase,
      object: obj
    });
  }

  private doneHandler(error: Error) {
    if (error) logger.warn("watch ended: " + error.toString());
    this.watchRequest.abort();
  }

  private sendEvent(evt: any) {
    // convert to "text/event-stream" format
    this.response.write(`data: ${JSON.stringify(evt)}\n\n`);
  }
}

class WatchRoute extends LensApi {

  public async routeWatch(request: LensApiRequest) {
    const { params, response, cluster} = request;
    const apis: string[] = request.query.getAll("api");
    const watchers: ApiWatcher[] = [];

    if (!apis.length) {
      this.respondJson(response, {
        message: "Empty request. Query params 'api' are not provided.",
        example: "?api=/api/v1/pods&api=/api/v1/nodes",
      }, 400);
      return;
    }

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    logger.debug("watch using kubeconfig:" + JSON.stringify(cluster.getProxyKubeconfig(), null, 2));

    apis.forEach(apiUrl => {
      const watcher = new ApiWatcher(apiUrl, cluster.getProxyKubeconfig(), response);
      watcher.start();
      watchers.push(watcher);
    });

    request.raw.req.on("close", () => {
      logger.debug("Watch request closed");
      watchers.map(watcher => watcher.stop());
    });

    request.raw.req.on("end", () => {
      logger.debug("Watch request ended");
      watchers.map(watcher => watcher.stop());
    });

  }
}

export const watchRoute = new WatchRoute();
