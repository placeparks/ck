import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkInstanceHealth } from '@/lib/railway/deploy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        instance: {
          include: {
            config: {
              include: {
                channels: true
              }
            }
          }
        },
        subscription: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    if (!user.instance) {
      return NextResponse.json({
        hasInstance: false,
        subscription: user.subscription
      })
    }

    // Check instance health
    const isHealthy = await checkInstanceHealth(user.instance.id)

    return NextResponse.json({
      hasInstance: true,
      instance: {
        id: user.instance.id,
        status: user.instance.status,
        port: user.instance.port,
        accessUrl: user.instance.accessUrl,
        qrCode: user.instance.qrCode,
        lastHealthCheck: user.instance.lastHealthCheck,
        createdAt: user.instance.createdAt,
        isHealthy,
        channels: user.instance.config?.channels || [],
        config: user.instance.config ? {
          provider: user.instance.config.provider,
          model: user.instance.config.model,
          agentName: user.instance.config.agentName,
          channels: user.instance.config.channels,
        } : null,
      },
      subscription: user.subscription
    })

  } catch (error: any) {
    console.error('Status check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
