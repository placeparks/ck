'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  MessageSquare, Send, Hash, Zap, Phone, Mail, Grid, Users,
  Plus, Settings, Power, PowerOff, RefreshCw, AlertCircle,
  CheckCircle2, XCircle, Wifi, WifiOff
} from 'lucide-react'

const channelIcons: Record<string, any> = {
  WHATSAPP: MessageSquare,
  TELEGRAM: Send,
  DISCORD: Hash,
  SLACK: Zap,
  SIGNAL: Phone,
  GOOGLE_CHAT: Mail,
  MATRIX: Grid,
  MSTEAMS: Users,
}

const channelNames: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  TELEGRAM: 'Telegram',
  DISCORD: 'Discord',
  SLACK: 'Slack',
  SIGNAL: 'Signal',
  GOOGLE_CHAT: 'Google Chat',
  MATRIX: 'Matrix',
  MSTEAMS: 'MS Teams',
}

interface Channel {
  id: string
  type: string
  enabled: boolean
  config: any
  botUsername?: string
  phoneNumber?: string
  inviteLink?: string
}

interface ChannelManagerProps {
  channels: Channel[]
  onRefresh: () => void
}

export default function ChannelManager({ channels, onRefresh }: ChannelManagerProps) {
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null)

  const toggleChannel = async (channelId: string, currentEnabled: boolean) => {
    setTogglingChannel(channelId)
    try {
      await fetch('/api/instance/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          enabled: !currentEnabled
        })
      })
      onRefresh()
    } catch (error) {
      console.error('Failed to toggle channel:', error)
    } finally {
      setTogglingChannel(null)
    }
  }

  const getChannelStatus = (channel: Channel) => {
    if (!channel.enabled) return { label: 'Disabled', color: 'bg-gray-500', icon: PowerOff }
    return { label: 'Connected', color: 'bg-green-500', icon: CheckCircle2 }
  }

  const getAccessInfo = (channel: Channel) => {
    switch (channel.type) {
      case 'WHATSAPP':
        return channel.phoneNumber || 'QR pairing required'
      case 'TELEGRAM':
        return channel.botUsername ? `@${channel.botUsername}` : 'Bot token configured'
      case 'DISCORD':
        return channel.inviteLink || 'Bot token configured'
      default:
        return channel.enabled ? 'Connected' : 'Disabled'
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Channel Management
            </CardTitle>
            <CardDescription>Manage your connected messaging platforms</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!channels || channels.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <WifiOff className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No channels configured</p>
            <p className="text-sm mt-1">Add channels from your instance settings</p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => {
              const Icon = channelIcons[channel.type] || MessageSquare
              const status = getChannelStatus(channel)
              const StatusIcon = status.icon

              return (
                <div
                  key={channel.id}
                  className={`flex items-center justify-between p-4 border rounded-lg transition ${
                    channel.enabled ? 'hover:bg-gray-50' : 'bg-gray-50/50 opacity-75'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-lg ${channel.enabled ? 'bg-purple-100' : 'bg-gray-100'}`}>
                      <Icon className={`h-5 w-5 ${channel.enabled ? 'text-purple-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold">
                          {channelNames[channel.type] || channel.type}
                        </span>
                        <Badge
                          className={`text-xs ${status.color} text-white`}
                        >
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {status.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{getAccessInfo(channel)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleChannel(channel.id, channel.enabled)}
                      disabled={togglingChannel === channel.id}
                    >
                      {channel.enabled ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Channel Health Summary */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-600">
                {channels.filter(c => c.enabled).length} of {channels.length} channels active
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-gray-500">Connected</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-xs text-gray-500">Disabled</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
