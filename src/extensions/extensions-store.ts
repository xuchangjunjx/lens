import type { LensExtensionId } from "./lens-extension";
import type { ExtensionLoader } from "./extension-loader";
import { BaseStore } from "../common/base-store";
import { action, computed, observable, reaction, toJS } from "mobx";

export interface LensExtensionsStoreModel {
  extensions: Record<LensExtensionId, LensExtensionState>;
}

export interface LensExtensionState {
  enabled?: boolean;
  name: string;
}

export class ExtensionsStore extends BaseStore<LensExtensionsStoreModel> {
  constructor() {
    super({
      configName: "lens-extensions",
    });
  }

  @computed
  get enabledExtensions() {
    const extensions: string[] = [];
    this.state.forEach((state, id) => {
      if (state.enabled) {
        extensions.push(state.name);
      }
    });
    return extensions;
  }

  protected state = observable.map<LensExtensionId, LensExtensionState>();

  protected getState(extensionLoader: ExtensionLoader) {
    const state: Record<LensExtensionId, LensExtensionState> = {};
    return Array.from(extensionLoader.userExtensions).reduce((state, [extId, ext]) => {
      state[extId] = {
        enabled: ext.isEnabled,
        name: ext.manifest.name,
      };
      return state;
    }, state);
  }

  async manageState(extensionLoader: ExtensionLoader) {
    await extensionLoader.whenLoaded;
    await this.whenLoaded;

    // apply state on changes from store
    reaction(() => this.state.toJS(), extensionsState => {
      extensionsState.forEach((state, extId) => {
        const ext = extensionLoader.getExtension(extId);
        if (ext && !ext.isBundled) {
          ext.isEnabled = state.enabled;
        }
      });
    });

    // save state on change `extension.isEnabled`
    reaction(() => this.getState(extensionLoader), extensionsState => {
      this.state.merge(extensionsState);
    });
  }

  isEnabled(extId: LensExtensionId) {
    const state = this.state.get(extId);
    return state && state.enabled; // by default false
  }

  @action
  protected fromStore({ extensions }: LensExtensionsStoreModel) {
    this.state.merge(extensions);
  }

  toJSON(): LensExtensionsStoreModel {
    return toJS({
      extensions: this.state.toJSON(),
    }, {
      recurseEverything: true
    });
  }
}

export const extensionsStore = new ExtensionsStore();
