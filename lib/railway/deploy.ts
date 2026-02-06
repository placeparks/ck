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
    // OpenClaw listens on port 18789 by default — tell Railway to route traffic there
    envVars.PORT = process.env.OPENCLAW_PORT || '18789'

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

    // --- Generate a public domain for the service ---
    let accessUrl = ''
    try {
      accessUrl = await railway.createServiceDomain(serviceId)
      console.log(`[Railway] Domain created: ${accessUrl}`)
    } catch (err) {
      console.warn('[Railway] Domain creation failed, will try to fetch existing:', err)
    }

    // If domain creation returned empty, check for existing domains
    if (!accessUrl) {
      const domains = await railway.getServiceDomains(serviceId)
      if (domains.length > 0) {
        accessUrl = domains[0]
        console.log(`[Railway] Using existing domain: ${accessUrl}`)
      }
    }

    // --- Override start command so the config JSON is written before OpenClaw starts ---
    // The auto-deploy triggered by createService may finish before this update lands;
    // redeployService below ensures the corrected command is actually used.
    //
    // OpenClaw Docker image:
    // - Runs as user "node" (non-root)
    // - Expects config at ~/.openclaw/openclaw.json (i.e. /home/node/.openclaw/openclaw.json)
    // - Listens on port 18789 (WebSocket gateway)
    // - The image's default entrypoint starts the gateway automatically
    //
    // We write the config to the expected path, then exec the original entrypoint.
    // If OPENCLAW_CMD is set, use that as the startup command; otherwise let
    // the image's default entrypoint/CMD handle it.
    const openclawCmd = process.env.OPENCLAW_CMD || ''
    const configDir = '/home/node/.openclaw'
    const configDirFallback = '/tmp/.openclaw'

    let startCmd: string
    if (openclawCmd) {
      // Custom command specified — use it directly
      startCmd =
        `mkdir -p ${configDir} ${configDirFallback} && ` +
        `printf '%s' "$OPENCLAW_CONFIG" > ${configDir}/openclaw.json && ` +
        `cp ${configDir}/openclaw.json ${configDirFallback}/openclaw.json 2>/dev/null; ` +
        `exec ${openclawCmd}`
    } else {
      // Use the Docker image's default entrypoint
      // Write config, then start the gateway using node (the OpenClaw Docker image is Node-based)
      startCmd =
        `mkdir -p ${configDir} ${configDirFallback} 2>/dev/null; ` +
        `printf '%s' "$OPENCLAW_CONFIG" > ${configDir}/openclaw.json && ` +
        `cp ${configDir}/openclaw.json ${configDirFallback}/openclaw.json 2>/dev/null; ` +
        `echo "Config written to ${configDir}/openclaw.json" && ` +
        `if command -v openclaw >/dev/null 2>&1; then exec openclaw; ` +
        `elif [ -f /app/dist/index.js ]; then exec node /app/dist/index.js; ` +
        `elif [ -f /app/index.js ]; then exec node /app/index.js; ` +
        `else echo "Starting with default entrypoint..." && exec node server.js; fi`
    }

    await railway.updateServiceInstance(serviceId, { startCommand: startCmd })
    await railway.redeployService(serviceId)

    // --- Poll until the deployment is live ---
    const deployUrl = await waitForDeployment(railway, serviceId)
    // Prefer the domain URL, fallback to deployment URL
    if (!accessUrl && deployUrl) {
      accessUrl = deployUrl
    }

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

  if (deployment) {
    await railway.removeDeployment(deployment.id)
  }

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

  try {
    const railway = new RailwayClient()
    const deployment = await railway.getLatestDeployment(instance.containerId)

    if (deployment && deployment.status === 'SUCCESS') {
      // Restart the running deployment in-place
      await railway.restartDeployment(deployment.id)
    } else {
      // Trigger a fresh redeploy
      await railway.redeployService(instance.containerId)
    }

    await prisma.instance.update({
      where: { id: instanceId },
      data: { status: InstanceStatus.RUNNING },
    })

    await logDeployment(instanceId, 'RESTART', 'SUCCESS', 'Instance restarted')
  } catch (error: any) {
    console.error('[Restart] Failed:', error)
    // Still set back to a valid state rather than leaving as RESTARTING
    await prisma.instance.update({
      where: { id: instanceId },
      data: { status: InstanceStatus.ERROR },
    })
    await logDeployment(instanceId, 'RESTART', 'FAILED', 'Restart failed', error.message)
    throw error
  }
}

export async function getInstanceLogs(instanceId: string, tail = 100): Promise<string> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
  if (!instance) throw new Error('Instance not found')
  if (!instance.containerId) return 'No Railway service ID configured.'

  try {
    const railway = new RailwayClient()
    const deployment = await railway.getLatestDeployment(instance.containerId)
    if (!deployment) return 'No deployments found.'

    const logs = await railway.getLogs(deployment.id, tail)
    if (logs.length === 0) return 'No logs available yet.'
    return logs.map(l => `[${l.timestamp}] [${l.severity}] ${l.message}`).join('\n')
  } catch (error: any) {
    console.error('[Logs] Failed to fetch:', error)
    return `Failed to fetch logs: ${error.message}`
  }
}

export async function checkInstanceHealth(instanceId: string): Promise<boolean> {
  try {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
    if (!instance || !instance.containerId) return false

    let railway: RailwayClient
    try {
      railway = new RailwayClient()
    } catch (err) {
      console.warn('[Health] Railway client init failed:', err)
      // If Railway env vars aren't set, just use the DB status
      return instance.status === 'RUNNING'
    }

    const deployment = await railway.getLatestDeployment(instance.containerId)

    if (!deployment) {
      // No deployment found — might be deploying or deleted
      return instance.status === 'RUNNING'
    }

    // Map Railway deployment status to instance health
    // Railway statuses: BUILDING, DEPLOYING, SUCCESS, FAILED, CRASHED, REMOVED, SLEEPING, SKIPPED, WAITING, QUEUED
    const healthyStatuses = ['SUCCESS']
    const transientStatuses = ['BUILDING', 'DEPLOYING', 'WAITING', 'QUEUED']
    const failedStatuses = ['FAILED', 'CRASHED', 'REMOVED']

    const isHealthy = healthyStatuses.includes(deployment.status)
    const isTransient = transientStatuses.includes(deployment.status)
    const isFailed = failedStatuses.includes(deployment.status)

    let newStatus: InstanceStatus
    if (isHealthy) {
      newStatus = InstanceStatus.RUNNING
    } else if (isTransient) {
      newStatus = InstanceStatus.DEPLOYING
    } else if (deployment.status === 'SLEEPING') {
      newStatus = InstanceStatus.STOPPED
    } else if (isFailed) {
      newStatus = InstanceStatus.ERROR
    } else {
      // Unknown status — keep current
      newStatus = instance.status as InstanceStatus
    }

    // Also grab the access URL if we don't have one
    let updateData: any = {
      lastHealthCheck: new Date(),
      status: newStatus,
    }

    if (!instance.accessUrl && instance.containerId) {
      try {
        const domains = await railway.getServiceDomains(instance.containerId)
        if (domains.length > 0) {
          updateData.accessUrl = domains[0]
        }
      } catch { /* best-effort */ }
    }

    await prisma.instance.update({
      where: { id: instanceId },
      data: updateData,
    })

    return isHealthy
  } catch (error) {
    console.error('[Health] checkInstanceHealth error:', error)
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
