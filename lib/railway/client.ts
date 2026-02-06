const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2'

interface GraphQLResponse<T = any> {
  data?: T
  errors?: { message: string }[]
}

export interface Deployment {
  id: string
  status: string
  url?: string
  createdAt?: string
}

export interface LogEntry {
  timestamp: string
  message: string
  severity: string
}

export class RailwayClient {
  private token: string
  private projectId: string
  private environmentId: string

  constructor() {
    const token = process.env.RAILWAY_TOKEN
    const projectId = process.env.RAILWAY_PROJECT_ID
    const environmentId = process.env.RAILWAY_ENVIRONMENT_ID

    if (!token || !projectId || !environmentId) {
      throw new Error(
        'Missing Railway env vars: RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID. ' +
        'PROJECT_ID and ENVIRONMENT_ID are auto-provided when running on Railway.'
      )
    }

    this.token = token
    this.projectId = projectId
    this.environmentId = environmentId

    console.log(`[Railway] token=${token.slice(0, 8)}…${token.slice(-4)} projectId=${projectId} envId=${environmentId}`)
  }

  private async graphql<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const res = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok) {
      throw new Error(`Railway API HTTP ${res.status}: ${await res.text()}`)
    }

    const json: GraphQLResponse<T> = await res.json()

    if (json.errors?.length) {
      console.error('[Railway] GraphQL errors:', JSON.stringify(json.errors))
      throw new Error(`Railway API: ${json.errors.map(e => e.message).join(', ')}`)
    }

    if (!json.data) {
      throw new Error('Railway API returned empty response')
    }

    return json.data
  }

  /** Verify token has access to the project (simple read test). */
  async verifyAccess(): Promise<void> {
    console.log('[Railway] Verifying token access to project...')
    const { project } = await this.graphql<{ project: { name: string } }>(`
      query project($id: String!) {
        project(id: $id) {
          name
        }
      }
    `, { id: this.projectId })
    console.log(`[Railway] ✅ Token has access to project: ${project.name}`)
  }

  /** Set environment variables on a service. */
  async setVariables(serviceId: string, env: Record<string, string>): Promise<void> {
    console.log(`[Railway] Setting ${Object.keys(env).length} variables on service ${serviceId}`)
    await this.graphql(`
      mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `, {
      input: {
        projectId: this.projectId,
        environmentId: this.environmentId,
        serviceId,
        variables: env,
      },
    })
  }

  /** Create a service from a Docker image. Railway auto-deploys on creation. */
  async createService(name: string, image: string, env: Record<string, string>): Promise<{ id: string }> {
    // First verify we have access
    await this.verifyAccess()

    console.log('[Railway] Creating service with input:', JSON.stringify({
      projectId: this.projectId,
      name,
      source: { image },
    }))

    // Create service without variables first
    const { serviceCreate } = await this.graphql<{ serviceCreate: { id: string } }>(`
      mutation serviceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
        }
      }
    `, {
      input: {
        projectId: this.projectId,
        name,
        source: { image },
      },
    })

    console.log(`[Railway] Service created: ${serviceCreate.id}`)

    // Set variables separately
    await this.setVariables(serviceCreate.id, env)

    return serviceCreate
  }

  /** Update build/deploy settings for a service instance (e.g. startCommand). */
  async updateServiceInstance(serviceId: string, input: { startCommand?: string }): Promise<void> {
    await this.graphql(`
      mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
      }
    `, {
      serviceId,
      environmentId: this.environmentId,
      input,
    })
  }

  /** Trigger a fresh deployment. */
  async redeployService(serviceId: string): Promise<void> {
    await this.graphql(`
      mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `, {
      serviceId,
      environmentId: this.environmentId,
    })
  }

  /** Delete a service and everything in it. */
  async deleteService(serviceId: string): Promise<void> {
    await this.graphql(`
      mutation serviceDelete($id: String!) {
        serviceDelete(id: $id)
      }
    `, { id: serviceId })
  }

  /** Find a service by name in the project. Returns service ID if found. */
  async findServiceByName(name: string): Promise<string | null> {
    const { project } = await this.graphql<{
      project: { services: { edges: { node: { id: string; name: string } }[] } }
    }>(`
      query project($id: String!) {
        project(id: $id) {
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `, { id: this.projectId })

    const match = project.services.edges.find(e => e.node.name === name)
    return match?.node.id ?? null
  }

  /** Return the most recent deployment for a service. */
  async getLatestDeployment(serviceId: string): Promise<Deployment | null> {
    try {
      const { deployments } = await this.graphql<{
        deployments: { edges: { node: Deployment }[] }
      }>(`
        query deployments($input: DeploymentListInput!, $first: Int) {
          deployments(input: $input, first: $first) {
            edges {
              node {
                id
                status
                url
                staticUrl
                createdAt
              }
            }
          }
        }
      `, {
        input: {
          projectId: this.projectId,
          environmentId: this.environmentId,
          serviceId,
        },
        first: 1,
      })

      const node = deployments.edges[0]?.node ?? null
      // Railway uses staticUrl for public domains; fall back to url
      if (node && !node.url && (node as any).staticUrl) {
        node.url = (node as any).staticUrl
      }
      return node
    } catch (error) {
      console.error('[Railway] getLatestDeployment failed:', error)
      return null
    }
  }

  /** Fetch log entries for a deployment. */
  async getLogs(deploymentId: string, limit = 100): Promise<LogEntry[]> {
    try {
      const { deploymentLogs } = await this.graphql<{ deploymentLogs: LogEntry[] }>(`
        query deploymentLogs($deploymentId: String!, $limit: Int) {
          deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
            timestamp
            message
            severity
          }
        }
      `, { deploymentId, limit })

      return deploymentLogs || []
    } catch (error) {
      console.error('[Railway] getLogs failed:', error)
      return []
    }
  }

  /** Generate a Railway service domain so the container is publicly accessible. */
  async createServiceDomain(serviceId: string): Promise<string> {
    try {
      const { serviceDomainCreate } = await this.graphql<{
        serviceDomainCreate: { domain: string }
      }>(`
        mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
          serviceDomainCreate(input: $input) {
            domain
          }
        }
      `, {
        input: {
          serviceId,
          environmentId: this.environmentId,
        },
      })
      return `https://${serviceDomainCreate.domain}`
    } catch (error: any) {
      // Domain may already exist
      console.warn('[Railway] createServiceDomain error (may already exist):', error.message)
      return ''
    }
  }

  /** Get existing domains for a service. */
  async getServiceDomains(serviceId: string): Promise<string[]> {
    try {
      const { domains } = await this.graphql<{
        domains: { serviceDomains: { domain: string }[] }
      }>(`
        query domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
          domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
            serviceDomains {
              domain
            }
          }
        }
      `, {
        projectId: this.projectId,
        environmentId: this.environmentId,
        serviceId,
      })
      return (domains?.serviceDomains || []).map((d: any) => `https://${d.domain}`)
    } catch (error) {
      console.error('[Railway] getServiceDomains failed:', error)
      return []
    }
  }

  /** Remove the active deployment — pauses the service without deleting it. */
  async removeDeployment(deploymentId: string): Promise<void> {
    await this.graphql(`
      mutation deploymentRemove($deploymentId: String!) {
        deploymentRemove(deploymentId: $deploymentId)
      }
    `, { deploymentId })
  }

  /** Restart a running deployment in-place. */
  async restartDeployment(deploymentId: string): Promise<void> {
    await this.graphql(`
      mutation deploymentRestart($deploymentId: String!) {
        deploymentRestart(deploymentId: $deploymentId)
      }
    `, { deploymentId })
  }
}
