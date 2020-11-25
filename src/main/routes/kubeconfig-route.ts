import { LensApiRequest } from "../router";
import { LensApi } from "../lens-api";
import { Cluster } from "../cluster";
import { CoreV1Api, V1Secret } from "@kubernetes/client-node";

function generateKubeConfig(username: string, secret: V1Secret, cluster: Cluster) {
  const tokenData = Buffer.from(secret.data["token"], "base64");
  return {
    'apiVersion': 'v1',
    'kind': 'Config',
    'clusters': [
      {
        'name': cluster.contextName,
        'cluster': {
          'server': cluster.apiUrl,
          'certificate-authority-data': secret.data["ca.crt"]
        }
      }
    ],
    'users': [
      {
        'name': username,
        'user': {
          'token': tokenData.toString("utf8"),
        }
      }
    ],
    'contexts': [
      {
        'name': cluster.contextName,
        'context': {
          'user': username,
          'cluster': cluster.contextName,
          'namespace': secret.metadata.namespace,
        }
      }
    ],
    'current-context': cluster.contextName
  };
}

class KubeconfigRoute extends LensApi {

  public async routeServiceAccountRoute(request: LensApiRequest) {
    const { params, response, cluster} = request;

    const client = cluster.getProxyKubeconfig().makeApiClient(CoreV1Api);
    const secretList = await client.listNamespacedSecret(params.namespace);
    const secret = secretList.body.items.find(secret => {
      const { annotations } = secret.metadata;
      return annotations && annotations["kubernetes.io/service-account.name"] == params.account;
    });
    const data = generateKubeConfig(params.account, secret, cluster);
    this.respondJson(response, data);
  }
}

export const kubeconfigRoute = new KubeconfigRoute();
