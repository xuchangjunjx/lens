import { Application } from "spectron"
import * as util from "../helpers/utils"
import { spawnSync } from "child_process"

jest.setTimeout(60000)

const TEST_NAMESPACE = "integration-tests"

const BACKSPACE = "\uE003"

describe("app start", () => {
  let app: Application
  const minikubeSetup = (): boolean => {
    if (!minikubeReady) {
      console.warn("minikube not running, skipping test")
      return false
    }
    return true
  } 
  const clickWhatsNew = async (app: Application) => {
    await app.client.waitUntilTextExists("h1", "What's new")
    await app.client.click("button.primary")
    await app.client.waitUntilTextExists("h1", "Welcome")
  }

  const addMinikubeCluster = async (app: Application) => {
    await app.client.click("div.add-cluster")
    await app.client.waitUntilTextExists("div", "Select kubeconfig file")
    await app.client.click("div.Select__control") // show the context drop-down list
    await app.client.waitUntilTextExists("div", "minikube")
    await app.client.click("div.minikube") // select minikube context
    await app.client.click("div.Select__control") // hide the context drop-down list
    await app.client.click("button.primary") // add minikube cluster
  }

  const waitForMinikubeDashboard = async (app: Application) => {
    await app.client.waitUntilTextExists("pre.kube-auth-out", "Authentication proxy started")
    await app.client.waitForExist(`iframe[name="minikube"]`)
    await app.client.frame("minikube")
    await app.client.waitUntilTextExists("span.link-text", "Cluster")
  }

  beforeEach(async () => {
    app = util.setup()
    await app.start()
    await app.client.waitUntilWindowLoaded()
    let windowCount = await app.client.getWindowCount()
    while (windowCount > 1) { // Wait for splash screen to be closed
      windowCount = await app.client.getWindowCount()
    }
    await app.client.windowByIndex(0)
    await app.client.waitUntilWindowLoaded()
  }, 20000)

  it('shows "whats new"', async () => {
    await clickWhatsNew(app)
  })

  it('allows to add a cluster', async () => {
    if (!minikubeSetup()) {
      return
    }
    await clickWhatsNew(app)
    await addMinikubeCluster(app)
    await waitForMinikubeDashboard(app)
    await app.client.click('a[href="/nodes"]')
    await app.client.waitUntilTextExists("div.TableCell", "Ready")
  })

  it('shows default namespace', async () => {
    if (!minikubeSetup()) {
      return
    }
    await clickWhatsNew(app)
    await addMinikubeCluster(app)
    await waitForMinikubeDashboard(app)
    await app.client.click('a[href="/namespaces"]')
    await app.client.waitUntilTextExists("div.TableCell", "default")
    await app.client.waitUntilTextExists("div.TableCell", "kube-system")

    await app.client.click("button.add-button")
    await app.client.waitUntilTextExists("div.AddNamespaceDialog", "Create Namespace")
    await app.client.keys(`${TEST_NAMESPACE}\n`)
    await app.client.waitForExist(`.name=${TEST_NAMESPACE}`)
  })

  it('allows to create a pod', async () => {
    if (!minikubeSetup()) {
      return
    }
    await clickWhatsNew(app)
    await addMinikubeCluster(app)
    await waitForMinikubeDashboard(app)
    await app.client.click(".sidebar-nav #workloads span.link-text")
    await app.client.waitUntilTextExists('a[href="/pods"]', "Pods")
    await app.client.click('a[href="/pods"]')
    await app.client.waitUntilTextExists("div.TableCell", "kube-apiserver")
    await app.client.click('.Icon.new-dock-tab')
    await app.client.waitUntilTextExists("li.MenuItem.create-resource-tab", "Create resource")
    await app.client.click("li.MenuItem.create-resource-tab")
    await app.client.waitForVisible(".CreateResource div.ace_content")
    // Write pod manifest to editor
    await app.client.keys("apiVersion: v1\n")
    await app.client.keys("kind: Pod\n")
    await app.client.keys("metadata:\n")
    await app.client.keys("  name: nginx-create-pod-test\n")
    await app.client.keys(`namespace: ${TEST_NAMESPACE}\n`)
    await app.client.keys(BACKSPACE + "spec:\n")
    await app.client.keys("  containers:\n")
    await app.client.keys("- name: nginx-create-pod-test\n")
    await app.client.keys("  image: nginx:alpine\n")
    // Create deployment
    await app.client.waitForEnabled("button.Button=Create & Close")
    await app.client.click("button.Button=Create & Close")
    // Wait until first bits of pod appears on dashboard
    await app.client.waitForExist(".name=nginx-create-pod-test")
    // Open pod details
    await app.client.click(".name=nginx-create-pod-test")
    await app.client.waitUntilTextExists("div.drawer-title-text", "Pod: nginx-create-pod-test")
  })

  afterEach(async () => {
    if (app && app.isRunning()) {
      return util.tearDown(app)
    }
  })

  // determine if minikube is running
  let minikubeReady = false
  let status = spawnSync("minikube status", {shell: true})
  if (status.status === 0) {
    minikubeReady = true
    // Remove TEST_NAMESPACE if it already exists
    status = spawnSync(`minikube kubectl -- get namespace ${TEST_NAMESPACE}`, {shell: true})
    if (status.status === 0) {
      console.warn(`Removing existing ${TEST_NAMESPACE} namespace`)
      status = spawnSync(`minikube kubectl -- delete namespace ${TEST_NAMESPACE}`, {shell: true})
      if (status.status === 0) {
        console.log(status.stdout.toString())
      } else {
        console.warn(`Error removing ${TEST_NAMESPACE} namespace: ${status.stderr.toString()}`)
        minikubeReady = false
      }
    }
  }
})
