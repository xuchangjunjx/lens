// Base class for building all kubernetes apis

import merge from "lodash/merge";
import { stringify } from "querystring";
import { IKubeObjectConstructor, KubeObject } from "./kube-object";
import { KubeJsonApi, KubeJsonApiData, KubeJsonApiDataList } from "./kube-json-api";
import { apiKube } from "./index";
import { kubeWatchApi } from "./kube-watch-api";
import { apiManager } from "./api-manager";
import { createKubeApiURL, parseKubeApi } from "./kube-api-parse";
import { apiKubePrefix, isDevelopment, isTestEnv } from "../../common/vars";

export interface IKubeApiOptions<T extends KubeObject> {
  /**
   * base api-path for listing all resources, e.g. "/api/v1/pods"
   */
  apiBase?: string;

  /**
   * If the API uses a different API endpoint (e.g. apiBase) depending on the cluster version,
   * fallback API bases can be listed individually.
   * The first (existing) API base is used in the requests, if apiBase is not found.
   * This option only has effect if checkPreferredVersion is true.
   */
  fallbackApiBases?: string[];

  objectConstructor?: IKubeObjectConstructor<T>;
  request?: KubeJsonApi;
  isNamespaced?: boolean;
  kind?: string;
  checkPreferredVersion?: boolean;
}

export interface IKubeApiQueryParams {
  watch?: boolean | number;
  resourceVersion?: string;
  timeoutSeconds?: number;
  limit?: number; // doesn't work with ?watch
  continue?: string; // might be used with ?limit from second request
  labelSelector?: string | string[]; // restrict list of objects by their labels, e.g. labelSelector: ["label=value"]
  fieldSelector?: string | string[]; // restrict list of objects by their fields, e.g. fieldSelector: "field=name"
}

export interface IKubePreferredVersion {
  preferredVersion?: {
    version: string;
  }
}

export interface IKubeResourceList {
  resources: {
    kind: string;
    name: string;
    namespaced: boolean;
    singularName: string;
    storageVersionHash: string;
    verbs: string[];
  }[];
}

export interface IKubeApiCluster {
  id: string;
}

export function forCluster<T extends KubeObject>(cluster: IKubeApiCluster, kubeClass: IKubeObjectConstructor<T>): KubeApi<T> {
  const request = new KubeJsonApi({
    apiBase: apiKubePrefix,
    debug: isDevelopment,
  }, {
    headers: {
      "X-Cluster-ID": cluster.id
    }
  });
  return new KubeApi({
    objectConstructor: kubeClass,
    request
  });
}

export class KubeApi<T extends KubeObject = any> {
  static parseApi = parseKubeApi;

  static watchAll(...apis: KubeApi[]) {
    const disposers = apis.map(api => api.watch());
    return () => disposers.forEach(unwatch => unwatch());
  }

  readonly kind: string;
  readonly apiBase: string;
  readonly apiPrefix: string;
  readonly apiGroup: string;
  readonly apiVersion: string;
  readonly apiVersionPreferred?: string;
  readonly apiResource: string;
  readonly isNamespaced: boolean;

  public objectConstructor: IKubeObjectConstructor<T>;
  protected request: KubeJsonApi;
  protected resourceVersions = new Map<string, string>();

  constructor(protected options: IKubeApiOptions<T>) {
    const {
      objectConstructor = KubeObject as IKubeObjectConstructor,
      request = apiKube,
      kind = options.objectConstructor?.kind,
      isNamespaced = options.objectConstructor?.namespaced
    } = options || {};
    if (!options.apiBase) {
      options.apiBase = objectConstructor.apiBase;
    }
    const { apiBase, apiPrefix, apiGroup, apiVersion, resource } = KubeApi.parseApi(options.apiBase);

    this.kind = kind;
    this.isNamespaced = isNamespaced;
    this.apiBase = apiBase;
    this.apiPrefix = apiPrefix;
    this.apiGroup = apiGroup;
    this.apiVersion = apiVersion;
    this.apiResource = resource;
    this.request = request;
    this.objectConstructor = objectConstructor;

    this.checkPreferredVersion();
    this.parseResponse = this.parseResponse.bind(this);
    apiManager.registerApi(apiBase, this);
  }

  get apiVersionWithGroup() {
    return [this.apiGroup, this.apiVersionPreferred ?? this.apiVersion]
      .filter(Boolean)
      .join("/");
  }

  /**
   * Returns the latest API prefix/group that contains the required resource.
   * First tries options.apiBase, then urls in order from options.fallbackApiBases.
   */
  private async getLatestApiPrefixGroup() {
    // Note that this.options.apiBase is the "full" url, whereas this.apiBase is parsed
    const apiBases = [this.options.apiBase, ...this.options.fallbackApiBases];

    for (const apiUrl of apiBases) {
      // Split e.g. "/apis/extensions/v1beta1/ingresses" to parts
      const { apiPrefix, apiGroup, apiVersionWithGroup, resource } = KubeApi.parseApi(apiUrl);

      // Request available resources
      try {
        const response = await this.request.get<IKubeResourceList>(`${apiPrefix}/${apiVersionWithGroup}`);

        // If the resource is found in the group, use this apiUrl
        if (response.resources?.find(kubeResource => kubeResource.name === resource)) {
          return { apiPrefix, apiGroup };
        }
      } catch (error) {
        // Exception is ignored as we can try the next url
        console.error(error);
      }
    }

    // Avoid throwing in tests
    if (isTestEnv) {
      return {
        apiPrefix: this.apiPrefix,
        apiGroup: this.apiGroup
      };
    }

    throw new Error(`Can't find working API for the Kubernetes resource ${this.apiResource}`);
  }

  /**
   * Get the apiPrefix and apiGroup to be used for fetching the preferred version.
   */
  private async getPreferredVersionPrefixGroup() {
    if (this.options.fallbackApiBases) {
      return this.getLatestApiPrefixGroup();
    } else {
      return {
        apiPrefix: this.apiPrefix,
        apiGroup: this.apiGroup
      };
    }
  }

  protected async checkPreferredVersion() {
    if (this.options.fallbackApiBases && !this.options.checkPreferredVersion) {
      throw new Error("checkPreferredVersion must be enabled if fallbackApiBases is set in KubeApi");
    }

    if (this.options.checkPreferredVersion && this.apiVersionPreferred === undefined) {
      const { apiPrefix, apiGroup } = await this.getPreferredVersionPrefixGroup();

      // The apiPrefix and apiGroup might change due to fallbackApiBases, so we must override them
      Object.defineProperty(this, "apiPrefix", {
        value: apiPrefix
      });
      Object.defineProperty(this, "apiGroup", {
        value: apiGroup
      });

      const res = await this.request.get<IKubePreferredVersion>(`${this.apiPrefix}/${this.apiGroup}`);
      Object.defineProperty(this, "apiVersionPreferred", {
        value: res?.preferredVersion?.version ?? null,
      });

      if (this.apiVersionPreferred) {
        Object.defineProperty(this, "apiBase", { value: this.getUrl() });
        apiManager.registerApi(this.apiBase, this);
      }
    }
  }

  setResourceVersion(namespace = "", newVersion: string) {
    this.resourceVersions.set(namespace, newVersion);
  }

  getResourceVersion(namespace = "") {
    return this.resourceVersions.get(namespace);
  }

  async refreshResourceVersion(params?: { namespace: string }) {
    return this.list(params, { limit: 1 });
  }

  getUrl({ name = "", namespace = "" } = {}, query?: Partial<IKubeApiQueryParams>) {
    const resourcePath = createKubeApiURL({
      apiPrefix: this.apiPrefix,
      apiVersion: this.apiVersionWithGroup,
      resource: this.apiResource,
      namespace: this.isNamespaced ? namespace : undefined,
      name,
    });
    return resourcePath + (query ? `?` + stringify(this.normalizeQuery(query)) : "");
  }

  protected normalizeQuery(query: Partial<IKubeApiQueryParams> = {}) {
    if (query.labelSelector) {
      query.labelSelector = [query.labelSelector].flat().join(",");
    }
    if (query.fieldSelector) {
      query.fieldSelector = [query.fieldSelector].flat().join(",");
    }
    return query;
  }

  protected parseResponse(data: KubeJsonApiData | KubeJsonApiData[] | KubeJsonApiDataList, namespace?: string): any {
    const KubeObjectConstructor = this.objectConstructor;
    if (KubeObject.isJsonApiData(data)) {
      return new KubeObjectConstructor(data);
    }

    // process items list response
    if (KubeObject.isJsonApiDataList(data)) {
      const { apiVersion, items, metadata } = data;
      this.setResourceVersion(namespace, metadata.resourceVersion);
      this.setResourceVersion("", metadata.resourceVersion);
      return items.map(item => new KubeObjectConstructor({
        kind: this.kind,
        apiVersion,
        ...item,
      }));
    }

    // custom apis might return array for list response, e.g. users, groups, etc.
    if (Array.isArray(data)) {
      return data.map(data => new KubeObjectConstructor(data));
    }

    return data;
  }

  async list({ namespace = "" } = {}, query?: IKubeApiQueryParams): Promise<T[]> {
    await this.checkPreferredVersion();
    return this.request
      .get(this.getUrl({ namespace }), { query })
      .then(data => this.parseResponse(data, namespace));
  }

  async get({ name = "", namespace = "default" } = {}, query?: IKubeApiQueryParams): Promise<T> {
    await this.checkPreferredVersion();
    return this.request
      .get(this.getUrl({ namespace, name }), { query })
      .then(this.parseResponse);
  }

  async create({ name = "", namespace = "default" } = {}, data?: Partial<T>): Promise<T> {
    await this.checkPreferredVersion();
    const apiUrl = this.getUrl({ namespace });

    return this.request
      .post(apiUrl, {
        data: merge({
          kind: this.kind,
          apiVersion: this.apiVersionWithGroup,
          metadata: {
            name,
            namespace
          }
        }, data)
      })
      .then(this.parseResponse);
  }

  async update({ name = "", namespace = "default" } = {}, data?: Partial<T>): Promise<T> {
    await this.checkPreferredVersion();
    const apiUrl = this.getUrl({ namespace, name });
    return this.request
      .put(apiUrl, { data })
      .then(this.parseResponse);
  }

  async delete({ name = "", namespace = "default" }) {
    await this.checkPreferredVersion();
    const apiUrl = this.getUrl({ namespace, name });
    return this.request.del(apiUrl);
  }

  getWatchUrl(namespace = "", query: IKubeApiQueryParams = {}) {
    return this.getUrl({ namespace }, {
      watch: 1,
      resourceVersion: this.getResourceVersion(namespace),
      ...query,
    });
  }

  watch(): () => void {
    return kubeWatchApi.subscribe(this);
  }
}

export * from "./kube-api-parse";
