'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  MessageSquare, Send, Hash, Zap, Phone, Mail, Grid, Users,
  Copy, ExternalLink, QrCode, Terminal, CheckCircle2, Info,
  Smartphone, Globe, AlertCircle
} from 'lucide-react'

const channelIcons: Record<string, any> = {
  WHATSAPP: Smartphone,
  TELEGRAM: Send,
  DISCORD: Hash,
  SLACK: Zap,
  SIGNAL: Phone,
  GOOGLE_CHAT: Mail,
  MATRIX: Grid,
  MSTEAMS: Users,
  LINE: MessageSquare,
  FEISHU: MessageSquare,
  MATTERMOST: Hash,
  WEBCHAT: Globe,
  NOSTR: Zap,
  TWITCH: MessageSquare,
  ZALO: MessageSquare,
  BLUEBUBBLES: Phone,
  NEXTCLOUD_TALK: MessageSquare,
}

const channelLabels: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  TELEGRAM: 'Telegram',
  DISCORD: 'Discord',
  SLACK: 'Slack',
  SIGNAL: 'Signal',
  GOOGLE_CHAT: 'Google Chat',
  MATRIX: 'Matrix',
  MSTEAMS: 'MS Teams',
  LINE: 'LINE',
  FEISHU: 'Feishu / Lark',
  MATTERMOST: 'Mattermost',
  WEBCHAT: 'WebChat',
  NOSTR: 'Nostr',
  TWITCH: 'Twitch',
  ZALO: 'Zalo',
  BLUEBUBBLES: 'BlueBubbles (iMessage)',
  NEXTCLOUD_TALK: 'Nextcloud Talk',
}

interface ChannelAccessProps {
  channels: any[]
  instanceStatus?: string
}

export default function ChannelAccess({ channels, instanceStatus }: ChannelAccessProps) {
  const [showingQR, setShowingQR] = useState<string | null>(null)
  const [pairingChannel, setPairingChannel] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const isOnline = instanceStatus === 'RUNNING'

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const getChannelSetupInfo = (channel: any) => {
    const config = channel.config || {}
    switch (channel.type) {
      case 'WHATSAPP':
        return {
          label: 'QR Code',
          status: isOnline ? 'Check logs for QR code' : 'Start instance first',
          action: 'qr',
        }
      case 'TELEGRAM':
        return {
          label: 'Bot',
          status: config.botUsername
            ? `@${config.botUsername.replace('@', '')}`
            : (channel.botUsername ? `@${channel.botUsername.replace('@', '')}` : 'Bot token configured'),
          link: (config.botUsername || channel.botUsername)
            ? `https://t.me/${(config.botUsername || channel.botUsername || '').replace('@', '')}`
            : undefined,
          action: 'pair',
        }
      case 'DISCORD':
        return {
          label: 'Invite',
          status: (config.applicationId || channel.config?.applicationId) ? 'Application ID set' : 'Token configured',
          link: (config.applicationId)
            ? `https://discord.com/api/oauth2/authorize?client_id=${config.applicationId}&permissions=277025508352&scope=bot`
            : undefined,
          action: 'invite',
        }
      case 'SLACK':
        return {
          label: 'Status',
          status: 'Bot & App tokens configured',
        }
      case 'SIGNAL':
        return {
          label: 'Phone',
          status: config.phoneNumber || channel.phoneNumber || 'Phone number configured',
        }
      case 'WEBCHAT':
        return {
          label: 'Widget',
          status: 'Embeddable widget ready',
        }
      default:
        return {
          label: 'Status',
          status: (channel.enabled !== false) ? 'Configured' : 'Disabled',
        }
    }
  }

  if (!channels || channels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Channel Access
          </CardTitle>
          <CardDescription>No channels configured yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            Configure channels during onboarding or in the Channels tab to connect your bot to messaging platforms.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Channel Access & Setup
          </CardTitle>
          <CardDescription>
            Connect to your bot on these platforms.
            {!isOnline && ' Start your instance to activate channels.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {channels.map((channel: any, index: number) => {
              const Icon = channelIcons[channel.type] || MessageSquare
              const info = getChannelSetupInfo(channel)

              return (
                <div
                  key={index}
                  className={`flex items-center justify-between p-4 border rounded-lg transition ${
                    isOnline ? 'hover:bg-gray-50' : 'opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-2.5 rounded-lg bg-purple-100">
                      <Icon className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-sm">
                          {channelLabels[channel.type] || channel.type.replace('_', ' ')}
                        </p>
                        <Badge
                          variant={channel.enabled !== false ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {channel.enabled !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {info.label}: {info.status}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {info.action === 'qr' && isOnline && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowingQR(channel.type)}
                      >
                        <QrCode className="h-4 w-4 mr-1.5" />
                        QR Guide
                      </Button>
                    )}

                    {info.action === 'pair' && (
                      <>
                        {info.link && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={info.link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1.5" />
                              Open Bot
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPairingChannel('TELEGRAM')
                            setPairingCode('')
                          }}
                        >
                          <Terminal className="h-4 w-4 mr-1.5" />
                          Pair
                        </Button>
                      </>
                    )}

                    {info.action === 'invite' && info.link && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={info.link} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1.5" />
                          Add to Server
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp QR Code Guide Modal */}
      {showingQR && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" />
                WhatsApp QR Code Setup
              </CardTitle>
              <CardDescription>
                Follow these steps to connect WhatsApp to your bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start gap-2 mb-3">
                  <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-900 font-medium">
                    The WhatsApp QR code appears in your instance logs on first startup
                  </p>
                </div>
                <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                  <li>Go to the <strong>Logs</strong> tab in your dashboard</li>
                  <li>Look for the QR code output (appears as ASCII art)</li>
                  <li>Open WhatsApp on your phone &rarr; <strong>Settings</strong> &rarr; <strong>Linked Devices</strong></li>
                  <li>Tap <strong>&quot;Link a Device&quot;</strong> and scan the QR code from the logs</li>
                  <li>Wait for the connection to be established</li>
                </ol>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Alternative: View logs directly on Railway
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-600">
                  <li>
                    Open your{' '}
                    <a href="https://railway.app/dashboard" target="_blank" rel="noopener noreferrer" className="text-purple-600 underline">
                      Railway Dashboard
                    </a>
                  </li>
                  <li>Navigate to your OpenClaw service</li>
                  <li>Click on the active deployment &rarr; <strong>View Logs</strong></li>
                  <li>The QR code will be visible in the deployment logs</li>
                </ol>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800">
                    <p className="font-medium mb-1">Important notes:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>QR code expires after ~60 seconds &mdash; scan quickly!</li>
                      <li>If expired, restart your instance to generate a new one</li>
                      <li>Only one WhatsApp session can be active at a time</li>
                      <li>If disconnected, restart the instance to re-pair</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const logsTab = document.querySelector('[value="logs"]') as HTMLElement
                    if (logsTab) logsTab.click()
                    setShowingQR(null)
                  }}
                >
                  <Terminal className="h-4 w-4 mr-2" />
                  Go to Logs
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowingQR(null)}
                >
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Telegram Pairing Modal */}
      {pairingChannel === 'TELEGRAM' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-lg w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Telegram Pairing
              </CardTitle>
              <CardDescription>
                Pair a Telegram user with your bot using a pairing code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-900 mb-2">How Telegram Pairing Works</p>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-blue-800">
                  <li>A user messages your bot on Telegram</li>
                  <li>
                    If <code className="bg-white px-1 py-0.5 rounded text-xs">dmPolicy</code> is{' '}
                    <strong>&quot;pairing&quot;</strong>, the bot sends them a pairing code
                  </li>
                  <li>Enter that code below to generate the approval command</li>
                  <li>Run the command in Railway Terminal to approve the user</li>
                </ol>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Pairing Code
                </label>
                <Input
                  placeholder="Enter the pairing code from Telegram"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                />
              </div>

              {pairingCode.trim() && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-gray-600" />
                    <p className="text-sm font-medium text-gray-700">
                      Run this command in Railway Terminal
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm bg-white px-3 py-2 rounded border font-mono break-all">
                      openclaw pairing approve telegram {pairingCode.trim()}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          `openclaw pairing approve telegram ${pairingCode.trim()}`,
                          'cli'
                        )
                      }
                    >
                      {copied === 'cli' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <p className="font-medium">Steps:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Open{' '}
                        <a href="https://railway.app/dashboard" target="_blank" rel="noopener noreferrer" className="text-purple-600 underline">
                          Railway Dashboard
                        </a>
                      </li>
                      <li>Go to your OpenClaw service &rarr; Deployments</li>
                      <li>Click active deployment &rarr; <strong>Terminal</strong> tab</li>
                      <li>Paste and run the command above</li>
                    </ol>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    <strong>Tip:</strong> To skip pairing, set{' '}
                    <code className="bg-white px-1 py-0.5 rounded">dmPolicy</code> to{' '}
                    <strong>&quot;open&quot;</strong> in your channel configuration. This allows
                    anyone to message your bot without approval.
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setPairingChannel(null)
                  setPairingCode('')
                }}
              >
                Close
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
