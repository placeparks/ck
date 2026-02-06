import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ChannelType } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Helper to verify user owns the channel
async function getUserWithConfig(email: string) {
  return prisma.user.findUnique({
    where: { email },
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
}

// GET - List channels for the user's instance
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getUserWithConfig(session.user.email)

    if (!user?.instance?.config) {
      return NextResponse.json({ channels: [] })
    }

    return NextResponse.json({ channels: user.instance.config.channels })

  } catch (error) {
    console.error('Channel fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Add a new channel
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, config } = await req.json()

    if (!type) {
      return NextResponse.json({ error: 'Missing channel type' }, { status: 400 })
    }

    // Validate channel type
    if (!Object.values(ChannelType).includes(type as ChannelType)) {
      return NextResponse.json({ error: 'Invalid channel type' }, { status: 400 })
    }

    const user = await getUserWithConfig(session.user.email)

    if (!user?.instance?.config) {
      return NextResponse.json({ error: 'No instance configuration found' }, { status: 404 })
    }

    // Check if channel type already exists
    const exists = user.instance.config.channels.some(c => c.type === type)
    if (exists) {
      return NextResponse.json({ error: 'Channel type already configured' }, { status: 409 })
    }

    // Create the channel
    const channel = await prisma.channel.create({
      data: {
        configId: user.instance.config.id,
        type: type as ChannelType,
        enabled: true,
        config: config || {},
        botUsername: config?.botUsername,
        phoneNumber: config?.phoneNumber,
        inviteLink: config?.inviteLink,
      }
    })

    // Update fullConfig JSON to include the new channel
    const currentFullConfig = (user.instance.config.fullConfig as any) || {}
    const channelKey = type.toLowerCase().replace('_', '')
    currentFullConfig.channels = currentFullConfig.channels || {}
    currentFullConfig.channels[channelKey] = { enabled: true, ...config }

    await prisma.configuration.update({
      where: { id: user.instance.config.id },
      data: { fullConfig: currentFullConfig }
    })

    return NextResponse.json({ channel })

  } catch (error) {
    console.error('Channel create error:', error)
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
    const user = await getUserWithConfig(session.user.email)

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

// PUT - Update channel configuration
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId, config } = await req.json()

    if (!channelId || !config) {
      return NextResponse.json({ error: 'Missing channelId or config' }, { status: 400 })
    }

    // Verify channel belongs to user
    const user = await getUserWithConfig(session.user.email)

    const userChannel = user?.instance?.config?.channels.find(c => c.id === channelId)
    if (!userChannel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Update channel config
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        config,
        botUsername: config.botUsername || userChannel.botUsername,
        phoneNumber: config.phoneNumber || userChannel.phoneNumber,
        inviteLink: config.inviteLink || userChannel.inviteLink,
      }
    })

    // Also update fullConfig JSON
    if (user?.instance?.config) {
      const currentFullConfig = (user.instance.config.fullConfig as any) || {}
      const channelKey = userChannel.type.toLowerCase().replace('_', '')
      if (currentFullConfig.channels) {
        currentFullConfig.channels[channelKey] = { enabled: userChannel.enabled, ...config }
      }
      await prisma.configuration.update({
        where: { id: user.instance.config.id },
        data: { fullConfig: currentFullConfig }
      })
    }

    return NextResponse.json({ channel: updated })

  } catch (error) {
    console.error('Channel config update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a channel
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId } = await req.json()

    if (!channelId) {
      return NextResponse.json({ error: 'Missing channelId' }, { status: 400 })
    }

    // Verify channel belongs to user
    const user = await getUserWithConfig(session.user.email)

    const userChannel = user?.instance?.config?.channels.find(c => c.id === channelId)
    if (!userChannel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Delete the channel
    await prisma.channel.delete({
      where: { id: channelId }
    })

    // Also remove from fullConfig JSON
    if (user?.instance?.config) {
      const currentFullConfig = (user.instance.config.fullConfig as any) || {}
      const channelKey = userChannel.type.toLowerCase().replace('_', '')
      if (currentFullConfig.channels && currentFullConfig.channels[channelKey]) {
        delete currentFullConfig.channels[channelKey]
      }
      await prisma.configuration.update({
        where: { id: user.instance.config.id },
        data: { fullConfig: currentFullConfig }
      })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Channel delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
