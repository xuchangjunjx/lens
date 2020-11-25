import { ipcRenderer } from "electron";
import { action, computed, observable, toJS, reaction } from "mobx";
import { BaseStore } from "./base-store";
import { clusterStore } from "./cluster-store";
import { appEventBus } from "./event-bus";
import { broadcastMessage } from "../common/ipc";
import logger from "../main/logger";
import type { ClusterId } from "./cluster-store";

export type WorkspaceId = string;

export interface WorkspaceStoreModel {
  workspaces: WorkspaceModel[];
  currentWorkspace?: WorkspaceId;
}

export interface WorkspaceModel {
  id: WorkspaceId;
  name: string;
  description?: string;
  ownerRef?: string;
  lastActiveClusterId?: ClusterId;
}

export interface WorkspaceState {
  enabled: boolean;
}

export class Workspace implements WorkspaceModel, WorkspaceState {
  @observable id: WorkspaceId;
  @observable name: string;
  @observable description?: string;
  @observable ownerRef?: string;
  @observable enabled: boolean;
  @observable lastActiveClusterId?: ClusterId;

  constructor(data: WorkspaceModel) {
    Object.assign(this, data);

    if (!ipcRenderer) {
      reaction(() => this.getState(), () => {
        this.pushState();
      });
    }
  }

  get isManaged(): boolean {
    return !!this.ownerRef;
  }

  getState(): WorkspaceState {
    return {
      enabled: this.enabled
    };
  }

  pushState(state = this.getState()) {
    logger.silly("[WORKSPACE] pushing state", {...state, id: this.id});
    broadcastMessage("workspace:state", this.id, toJS(state));
  }

  @action
  setState(state: WorkspaceState) {
    Object.assign(this, state);
  }

  toJSON(): WorkspaceModel {
    return toJS({
      id: this.id,
      name: this.name,
      description: this.description,
      ownerRef: this.ownerRef,
      lastActiveClusterId: this.lastActiveClusterId
    });
  }
}

export class WorkspaceStore extends BaseStore<WorkspaceStoreModel> {
  static readonly defaultId: WorkspaceId = "default";

  private constructor() {
    super({
      configName: "lens-workspace-store",
    });

    if (!ipcRenderer) {
      setInterval(() => {
        this.pushState();
      }, 5000);
    }
  }

  registerIpcListener() {
    logger.info("[WORKSPACE-STORE] starting to listen state events");
    ipcRenderer.on("workspace:state", (event, workspaceId: string, state: WorkspaceState) => {
      this.getById(workspaceId)?.setState(state);
    });
  }

  unregisterIpcListener() {
    super.unregisterIpcListener();
    ipcRenderer.removeAllListeners("workspace:state");
  }

  @observable currentWorkspaceId = WorkspaceStore.defaultId;

  @observable workspaces = observable.map<WorkspaceId, Workspace>({
    [WorkspaceStore.defaultId]: new Workspace({
      id: WorkspaceStore.defaultId,
      name: "default"
    })
  });

  @computed get currentWorkspace(): Workspace {
    return this.getById(this.currentWorkspaceId);
  }

  @computed get workspacesList() {
    return Array.from(this.workspaces.values());
  }

  @computed get enabledWorkspacesList() {
    return this.workspacesList.filter((w) => w.enabled);
  }

  pushState() {
    this.workspaces.forEach((w) => {
      w.pushState();
    });
  }

  isDefault(id: WorkspaceId) {
    return id === WorkspaceStore.defaultId;
  }

  getById(id: WorkspaceId): Workspace {
    return this.workspaces.get(id);
  }

  getByName(name: string): Workspace {
    return this.workspacesList.find(workspace => workspace.name === name);
  }

  @action
  setActive(id = WorkspaceStore.defaultId) {
    if (id === this.currentWorkspaceId) return;
    if (!this.getById(id)) {
      throw new Error(`workspace ${id} doesn't exist`);
    }
    this.currentWorkspaceId = id;
  }

  @action
  addWorkspace(workspace: Workspace) {
    const { id, name } = workspace;
    if (!name.trim() || this.getByName(name.trim())) {
      return;
    }
    this.workspaces.set(id, workspace);
    appEventBus.emit({name: "workspace", action: "add"});
    return workspace;
  }

  @action
  updateWorkspace(workspace: Workspace) {
    this.workspaces.set(workspace.id, workspace);
    appEventBus.emit({name: "workspace", action: "update"});
  }

  @action
  removeWorkspace(workspace: Workspace) {
    this.removeWorkspaceById(workspace.id);
  }

  @action
  removeWorkspaceById(id: WorkspaceId) {
    const workspace = this.getById(id);
    if (!workspace) return;
    if (this.isDefault(id)) {
      throw new Error("Cannot remove default workspace");
    }
    if (this.currentWorkspaceId === id) {
      this.currentWorkspaceId = WorkspaceStore.defaultId; // reset to default
    }
    this.workspaces.delete(id);
    appEventBus.emit({name: "workspace", action: "remove"});
    clusterStore.removeByWorkspaceId(id);
  }

  @action
  setLastActiveClusterId(clusterId?: ClusterId, workspaceId = this.currentWorkspaceId) {
    this.getById(workspaceId).lastActiveClusterId = clusterId;
  }

  @action
  protected fromStore({ currentWorkspace, workspaces = [] }: WorkspaceStoreModel) {
    if (currentWorkspace) {
      this.currentWorkspaceId = currentWorkspace;
    }
    if (workspaces.length) {
      this.workspaces.clear();
      workspaces.forEach(ws => {
        const workspace = new Workspace(ws);
        if (!workspace.isManaged) {
          workspace.enabled = true;
        }
        this.workspaces.set(workspace.id, workspace);
      });
    }
  }

  toJSON(): WorkspaceStoreModel {
    return toJS({
      currentWorkspace: this.currentWorkspaceId,
      workspaces: this.workspacesList.map((w) => w.toJSON()),
    }, {
      recurseEverything: true
    });
  }
}

export const workspaceStore = WorkspaceStore.getInstance<WorkspaceStore>();
