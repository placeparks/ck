import { RailwayClient } from './client'
import { prisma } from '@/lib/prisma'
import { allocatePort } from '@/lib/utils/port-allocator'
import {
  generateOpenClawConfig,
  buildEnvironmentVariables,
  UserConfiguration,
} from '@/lib/openclaw/config-builder'
import { InstanceStatus } from '@prisma/client'

const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || 'ghcr.io/openclaw/openclaw:latest'

const POLL_INTERVAL_MS = 3000
const DEPLOY_TIMEOUT_MS = 120_000 // 2 minutes

interface DeploymentResult {
  instanceId: string
  containerId: string   // Railway service ID
  containerName: string
  port: number          // Unique DB value; not an actual network port
  accessUrl: string     // Railway-assigned public URL
  status: string
}

export async function deployInstance(
  userId: string,
  config: UserConfiguration
): Promise<DeploymentResult> {
  const railway = new RailwayClient()
  const serviceName = `openclaw-${userId}`

  // --- Clean up any pre-existing instance ---
  const existing = await prisma.instance.findUnique({ where: { userId } })
  if (existing) {
    console.log(`⚠️  Cleaning up existing DB instance for user ${userId}...`)
    try {
      if (existing.containerId) {
        await railway.deleteService(existing.containerId)
      }
      await prisma.instance.delete({ where: { id: existing.id } })
      console.log('✅ DB instance cleaned up')
    } catch (err) {
      console.warn('⚠️  DB cleanup error (continuing):', err)
    }
  }

  // --- Also clean up orphaned Railway service by name (in case previous deploy failed mid-way) ---
  try {
    const orphanedServiceId = await railway.findServiceByName(serviceName)
    if (orphanedServiceId) {
      console.log(`⚠️  Found orphaned Railway service ${serviceName}, deleting...`)
      await railway.deleteService(orphanedServiceId)
      console.log('✅ Orphaned service deleted')
    }
  } catch (err) {
    console.warn('⚠️  Orphan cleanup error (continuing):', err)
  }

  // --- Create placeholder DB record ---
  const port = await allocatePort()
  const instance = await prisma.instance.create({
    data: {
      userId,
      containerId: null,  // filled in after Railway service is created
      containerName: serviceName,
      port,
      status: InstanceStatus.DEPLOYING,
    },
  })

  await logDeployment(instance.id, 'DEPLOY', 'IN_PROGRESS', 'Creating Railway service...')

  try {
    // --- Build env vars for the OpenClaw container ---
    const envVars = buildEnvironmentVariables(config)
    const openclawConfig = generateOpenClawConfig(config)
    // Serialized config; the start command writes it to the expected file path
    envVars.OPENCLAW_CONFIG = JSON.stringify(openclawConfig)
    // Gateway token required by OpenClaw (generate a random one per instance)
    envVars.OPENCLAW_GATEWAY_TOKEN = crypto.randomUUID()

    // --- Create Railway service (image + env vars, auto-deploys) ---
    const { id: serviceId } = await railway.createService(
      serviceName,
      OPENCLAW_IMAGE,
      envVars
    )

    // Persist the Railway service ID immediately
    await prisma.instance.update({
      where: { id: instance.id },
      data: { containerId: serviceId },
    })

    // --- Override start command so the config JSON is written before OpenClaw starts ---
    // The auto-deploy triggered by createService may finish before this update lands;
    // redeployService below ensures the corrected command is actually used.
    // NOTE: Railway runs containers as non-root, so we use /tmp instead of /root
    const openclawCmd = process.env.OPENCLAW_CMD || 'openclaw'
    const configDir = '/tmp/.openclaw'
    const startCmd =
      `mkdir -p ${configDir} && ` +
      `printf '%s' "$OPENCLAW_CONFIG" > ${configDir}/openclaw.json && ` +
      `exec ${openclawCmd} --config ${configDir}/openclaw.json`

    await railway.updateServiceInstance(serviceId, { startCommand: startCmd })
    await railway.redeployService(serviceId)

    // --- Poll until the deployment is live ---
    const accessUrl = await waitForDeployment(railway, serviceId)

    await prisma.instance.update({
      where: { id: instance.id },
      data: { status: InstanceStatus.RUNNING, accessUrl },
    })

    await logDeployment(instance.id, 'DEPLOY', 'SUCCESS', 'Deployment completed')

    return {
      instanceId: instance.id,
      containerId: serviceId,
      containerName: serviceName,
      port,
      accessUrl,
      status: 'RUNNING',
    }
  } catch (error: any) {
    await prisma.instance.update({
      where: { id: instance.id },
      data: { status: InstanceStatus.ERROR },
    })

    await logDeployment(instance.id, 'DEPLOY', 'FAILED', 'Deployment failed', error.message)
    throw new Error(`Deployment failed: ${error.message}`)
  }
}

/**
 * Poll Railway until the latest deployment reaches a terminal state.
 * Returns the public URL on SUCCESS.
 */
async function waitForDeployment(
  railway: RailwayClient,
  serviceId: string
): Promise<string> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS

  while (Date.now() < deadline) {
    const deployment = await railway.getLatestDeployment(serviceId)

    if (!deployment) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    console.log(`  [Railway] deployment ${deployment.id} → ${deployment.status}`)

    switch (deployment.status) {
      case 'SUCCESS':
        return deployment.url || ''

      case 'FAILED':
      case 'CRASHED': {
        let logSnippet = ''
        try {
          const logs = await railway.getLogs(deployment.id, 30)
          logSnippet = logs.map(l => `[${l.severity}] ${l.message}`).join('\n')
        } catch { /* best-effort */ }
        throw new Error(`Railway deployment ${deployment.status}.\n${logSnippet}`)
      }
    }

    // BUILDING / DEPLOYING / other transient states — keep polling
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error('Deployment timed out (2 min)')
}

export async function stopInstance(instanceId: string): Promise<void> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new Error('Instance not found')
  if (!instance.containerId) throw new Error('Instance has no Railway service ID')

  const railway = new RailwayClient()
  const deployment = await railway.getLatestDeployment(instance.containerId)
  if (!deployment) throw new Error('No active deployment found')

  await railway.removeDeployment(deployment.id)

  await prisma.instance.update({
    where: { id: instanceId },
    data: { status: InstanceStatus.STOPPED },
  })

  await logDeployment(instanceId, 'STOP', 'SUCCESS', 'Instance stopped')
}

export async function startInstance(instanceId: string): Promise<void> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new Error('Instance not found')
  if (!instance.containerId) throw new Error('Instance has no Railway service ID')

  const railway = new RailwayClient()
  await railway.redeployService(instance.containerId)

  await prisma.instance.update({
    where: { id: instanceId },
    data: { status: InstanceStatus.RUNNING },
  })

  await logDeployment(instanceId, 'START', 'SUCCESS', 'Instance started')
}

export async function restartInstance(instanceId: string): Promise<void> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new Error('Instance not found')
  if (!instance.containerId) throw new Error('Instance has no Railway service ID')

  await prisma.instance.update({
    where: { id: instanceId },
    data: { status: InstanceStatus.RESTARTING },
  })

  const railway = new RailwayClient()
  const deployment = await railway.getLatestDeployment(instance.containerId)

  if (deployment && deployment.status === 'SUCCESS') {
    await railway.restartDeployment(deployment.id)
  } else {
    await railway.redeployService(instance.containerId)
  }

  await prisma.instance.update({
    where: { id: instanceId },
    data: { status: InstanceStatus.RUNNING },
  })

  await logDeployment(instanceId, 'RESTART', 'SUCCESS', 'Instance restarted')
}

export async function getInstanceLogs(instanceId: string, tail = 100): Promise<string> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new Error('Instance not found')
  if (!instance.containerId) throw new Error('Instance has no Railway service ID')

  const railway = new RailwayClient()
  const deployment = await railway.getLatestDeployment(instance.containerId)
  if (!deployment) return 'No deployments found.'

  const logs = await railway.getLogs(deployment.id, tail)
  return logs.map(l => `[${l.timestamp}] [${l.severity}] ${l.message}`).join('\n')
}

export async function checkInstanceHealth(instanceId: string): Promise<boolean> {
  try {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
    if (!instance || !instance.containerId) return false

    const railway = new RailwayClient()
    const deployment = await railway.getLatestDeployment(instance.containerId)
    const isHealthy = deployment?.status === 'SUCCESS'

    await prisma.instance.update({
      where: { id: instanceId },
      data: {
        lastHealthCheck: new Date(),
        status: isHealthy ? InstanceStatus.RUNNING : InstanceStatus.ERROR,
      },
    })

    return isHealthy
  } catch {
    return false
  }
}

async function logDeployment(
  instanceId: string,
  action: string,
  status: string,
  message: string,
  error?: string
): Promise<void> {
  await prisma.deploymentLog.create({
    data: { instanceId, action, status, message, error },
  })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
