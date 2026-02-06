import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Helper to create a JSON response with CORS headers */
function jsonResponse(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders })
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

/**
 * WebChat API — proxies messages to the user's OpenClaw instance.
 *
 * POST /api/webchat
 * Body: { instanceId, message, sessionId? }
 *
 * This endpoint is called from the embeddable widget (widget.js)
 * and does NOT require auth — it's a public-facing chat endpoint.
 * The instanceId scopes it to the correct user's bot.
 */
export async function POST(req: Request) {
  try {
    const { instanceId, message, sessionId } = await req.json()

    if (!instanceId || !message) {
      return jsonResponse({ error: 'Missing instanceId or message' }, 400)
    }

    // Look up the instance
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: {
        config: true,
        user: {
          include: { subscription: true }
        }
      }
    })

    if (!instance) {
      return jsonResponse({ error: 'Instance not found' }, 404)
    }

    if (instance.status !== 'RUNNING') {
      return jsonResponse(
        { error: 'Instance is not running', reply: 'The bot is currently offline. Please try again later.', status: instance.status },
        503
      )
    }

    // Check free tier message limits
    const subscription = instance.user?.subscription
    if (subscription?.plan === 'FREE') {
      const messagesUsed = subscription.messagesUsed || 0
      const messagesLimit = subscription.messagesLimit || 100
      if (messagesUsed >= messagesLimit) {
        return jsonResponse(
          { error: 'Free tier message limit reached', reply: 'Sorry, the free tier message limit has been reached. Please ask the bot owner to upgrade their plan.' },
          429
        )
      }

      // Increment message count
      try {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { messagesUsed: messagesUsed + 1 }
        })
      } catch (err) {
        // Non-critical — don't block the chat
        console.warn('[WebChat] Failed to update message count:', err)
      }
    }

    // If the instance has an accessUrl (Railway public domain), proxy to it
    if (instance.accessUrl) {
      try {
        const openclawResponse = await fetch(`${instance.accessUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            sessionId: sessionId || `webchat-${Date.now()}`,
            channel: 'webchat',
          }),
          signal: AbortSignal.timeout(30000), // 30s timeout
        })

        if (openclawResponse.ok) {
          const data = await openclawResponse.json()
          return jsonResponse({
            reply: data.reply || data.message || data.response || 'No response',
            sessionId: data.sessionId || sessionId,
          })
        } else {
          const errorText = await openclawResponse.text()
          console.error('[WebChat] OpenClaw error:', errorText)
          return jsonResponse({
            reply: 'Sorry, I encountered an error processing your message. Please try again.',
            error: 'upstream_error',
          })
        }
      } catch (fetchError: any) {
        console.error('[WebChat] Fetch to OpenClaw failed:', fetchError.message)
        return jsonResponse({
          reply: 'Sorry, I am temporarily unavailable. Please try again in a moment.',
          error: 'connection_error',
        })
      }
    }

    // No access URL — instance may still be deploying or doesn't have a public domain
    return jsonResponse({
      reply: 'The bot is still being set up. Please try again in a few minutes.',
      error: 'no_access_url',
    })
  } catch (error: any) {
    console.error('[WebChat] Error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

/**
 * GET /api/webchat?instanceId=xxx
 * Returns basic info about the webchat instance (agent name, status)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const instanceId = searchParams.get('instanceId')

  if (!instanceId) {
    return jsonResponse({ error: 'Missing instanceId' }, 400)
  }

  try {
    const instance = await prisma.instance.findUnique({
      where: { id: instanceId },
      include: { config: true }
    })

    if (!instance) {
      return jsonResponse({ error: 'Not found' }, 404)
    }

    return jsonResponse({
      agentName: instance.config?.agentName || 'AI Assistant',
      status: instance.status,
      online: instance.status === 'RUNNING',
    })
  } catch (error: any) {
    console.error('[WebChat] GET error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
