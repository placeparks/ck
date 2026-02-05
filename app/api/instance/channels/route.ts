import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET - List channels for the user's instance
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        instance: {
          include: {
            config: {
              include: { channels: true }
            }
          }
        }
      }
    })

    if (!user?.instance?.config) {
      return NextResponse.json({ channels: [] })
    }

    return NextResponse.json({ channels: user.instance.config.channels })

  } catch (error) {
    console.error('Channel fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Enable/disable a channel
export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId, enabled } = await req.json()

    if (!channelId || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Verify channel belongs to user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        instance: {
          include: {
            config: {
              include: { channels: true }
            }
          }
        }
      }
    })

    const userChannelIds = user?.instance?.config?.channels.map(c => c.id) || []
    if (!userChannelIds.includes(channelId)) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { enabled }
    })

    return NextResponse.json({ channel: updated })

  } catch (error) {
    console.error('Channel update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
