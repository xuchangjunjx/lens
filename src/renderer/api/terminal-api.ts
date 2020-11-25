import { stringify } from "querystring";
import { autobind, base64, EventEmitter } from "../utils";
import { WebSocketApi } from "./websocket-api";
import isEqual from "lodash/isEqual";
import { isDevelopment } from "../../common/vars";

export enum TerminalChannels {
  STDIN = 0,
  STDOUT = 1,
  STDERR = 2,
  TERMINAL_SIZE = 4,
  TOKEN = 9,
}

enum TerminalColor {
  RED = "\u001b[31m",
  GREEN = "\u001b[32m",
  YELLOW = "\u001b[33m",
  BLUE = "\u001b[34m",
  MAGENTA = "\u001b[35m",
  CYAN = "\u001b[36m",
  GRAY = "\u001b[90m",
  LIGHT_GRAY = "\u001b[37m",
  NO_COLOR = "\u001b[0m",
}

export type TerminalApiQuery = Record<string, string> & {
  id: string;
  node?: string;
  type?: string | "node";
};

export class TerminalApi extends WebSocketApi {
  protected size: { Width: number; Height: number };

  public onReady = new EventEmitter<[]>();
  public isReady = false;

  constructor(protected options: TerminalApiQuery) {
    super({
      logging: isDevelopment,
      flushOnOpen: false,
      pingIntervalSeconds: 30,
    });
  }

  async getUrl() {
    let { port } = location;
    const { hostname, protocol } = location;
    const { id, node } = this.options;
    const wss = `ws${protocol === "https:" ? "s" : ""}://`;
    const query: TerminalApiQuery = { id };
    if (port) {
      port = `:${port}`;
    }
    if (node) {
      query.node = node;
      query.type = "node";
    }
    return `${wss}${hostname}${port}/api?${stringify(query)}`;
  }

  async connect() {
    const apiUrl = await this.getUrl();
    this.emitStatus("Connecting ...");
    this.onData.addListener(this._onReady, { prepend: true });
    return super.connect(apiUrl);
  }

  destroy() {
    if (!this.socket) return;
    const exitCode = String.fromCharCode(4); // ctrl+d
    this.sendCommand(exitCode);
    setTimeout(() => super.destroy(), 2000);
  }

  removeAllListeners() {
    super.removeAllListeners();
    this.onReady.removeAllListeners();
  }

  @autobind()
  protected _onReady(data: string) {
    if (!data) return;
    this.isReady = true;
    this.onReady.emit();
    this.onData.removeListener(this._onReady);
    this.flush();
    this.onData.emit(data); // re-emit data
    return false; // prevent calling rest of listeners
  }

  reconnect() {
    const { reconnectDelaySeconds } = this.params;
    super.reconnect();
  }

  sendCommand(key: string, channel = TerminalChannels.STDIN) {
    return this.send(channel + base64.encode(key));
  }

  sendTerminalSize(cols: number, rows: number) {
    const newSize = { Width: cols, Height: rows };
    if (!isEqual(this.size, newSize)) {
      this.sendCommand(JSON.stringify(newSize), TerminalChannels.TERMINAL_SIZE);
      this.size = newSize;
    }
  }

  protected parseMessage(data: string) {
    data = data.substr(1); // skip channel
    return base64.decode(data);
  }

  protected _onOpen(evt: Event) {
    // Client should send terminal size in special channel 4,
    // But this size will be changed by terminal.fit()
    this.sendTerminalSize(120, 80);
    super._onOpen(evt);
  }

  protected _onClose(evt: CloseEvent) {
    super._onClose(evt);
    this.isReady = false;
  }

  protected emitStatus(data: string, options: { color?: TerminalColor; showTime?: boolean } = {}) {
    const { color, showTime } = options;
    if (color) {
      data = `${color}${data}${TerminalColor.NO_COLOR}`;
    }
    let time;
    if (showTime) {
      time = (new Date()).toLocaleString() + " ";
    }
    this.onData.emit(`${showTime ? time : ""}${data}\r\n`);
  }

  protected emitError(error: string) {
    this.emitStatus(error, {
      color: TerminalColor.RED
    });
  }
}
