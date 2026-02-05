'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Globe, Copy, CheckCircle2, Code, Eye, Palette
} from 'lucide-react'

interface WebChatWidgetProps {
  instanceId: string
  accessUrl?: string
  agentName?: string
}

export default function WebChatWidget({ instanceId, accessUrl, agentName }: WebChatWidgetProps) {
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right')
  const [primaryColor, setPrimaryColor] = useState('#7c3aed')
  const [greeting, setGreeting] = useState(`Hi! I'm ${agentName || 'your AI assistant'}. How can I help?`)

  const widgetUrl = accessUrl ? `${accessUrl}/webchat` : 'https://your-instance.railway.app/webchat'

  const embedCode = `<!-- Kainat WebChat Widget -->
<script>
  (function() {
    var w = document.createElement('script');
    w.src = '${widgetUrl}/widget.js';
    w.async = true;
    w.dataset.instanceId = '${instanceId}';
    w.dataset.theme = '${theme}';
    w.dataset.position = '${position}';
    w.dataset.color = '${primaryColor}';
    w.dataset.greeting = '${greeting}';
    document.head.appendChild(w);
  })();
</script>`

  const iframeCode = `<iframe
  src="${widgetUrl}?theme=${theme}&color=${encodeURIComponent(primaryColor)}"
  style="border:none; width:400px; height:600px; border-radius:12px; box-shadow: 0 4px 24px rgba(0,0,0,0.15);"
  title="${agentName || 'Chat'}"
></iframe>`

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Embeddable Web Chat
        </CardTitle>
        <CardDescription>
          Add a chat widget to your website. Visitors can chat with your bot directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Customization */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-sm">Theme</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('light')}
              >
                Light
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('dark')}
              >
                Dark
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-sm">Position</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={position === 'bottom-right' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPosition('bottom-right')}
              >
                Bottom Right
              </Button>
              <Button
                variant={position === 'bottom-left' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPosition('bottom-left')}
              >
                Bottom Left
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-sm flex items-center gap-1">
              <Palette className="h-3.5 w-3.5" />
              Primary Color
            </Label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded border cursor-pointer"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1"
                placeholder="#7c3aed"
              />
            </div>
          </div>

          <div>
            <Label className="text-sm">Greeting Message</Label>
            <Input
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Hi! How can I help?"
              className="mt-1"
            />
          </div>
        </div>

        {/* Preview */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
            <Eye className="h-4 w-4" />
            Preview
          </h4>
          <div className={`border rounded-lg p-4 ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'}`}>
            <div className={`w-80 mx-auto rounded-xl shadow-lg overflow-hidden ${
              theme === 'dark' ? 'bg-gray-800' : 'bg-white'
            }`}>
              {/* Widget Header */}
              <div className="p-3" style={{ backgroundColor: primaryColor }}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <Globe className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{agentName || 'AI Assistant'}</p>
                    <p className="text-white/70 text-xs">Online</p>
                  </div>
                </div>
              </div>
              {/* Widget Body */}
              <div className={`p-3 min-h-[120px] ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <div className={`inline-block px-3 py-2 rounded-lg text-sm ${
                  theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'
                }`}>
                  {greeting}
                </div>
              </div>
              {/* Widget Input */}
              <div className={`p-3 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className={`rounded-full px-4 py-2 text-sm ${
                  theme === 'dark' ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-400'
                }`}>
                  Type a message...
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Embed Code - Script */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <Code className="h-4 w-4" />
              Embed Code (Floating Widget)
            </h4>
            <Button variant="outline" size="sm" onClick={() => copyCode(embedCode)}>
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1" />
              )}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto">
            {embedCode}
          </pre>
        </div>

        {/* Embed Code - iFrame */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <Code className="h-4 w-4" />
              Embed Code (Inline iFrame)
            </h4>
            <Button variant="outline" size="sm" onClick={() => copyCode(iframeCode)}>
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy
            </Button>
          </div>
          <pre className="bg-gray-900 text-blue-400 p-4 rounded-lg text-xs overflow-x-auto">
            {iframeCode}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
