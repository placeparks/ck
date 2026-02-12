'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Send, Bot, User, Loader2, Trash2, WifiOff,
  MessageCircle, RefreshCw, Copy, CheckCircle2
} from 'lucide-react'

interface ChatMessage {
  id: string
  role: 'user' | 'bot'
  text: string
  timestamp: Date
}

interface LiveChatProps {
  instanceId: string
  instanceStatus: string
  agentName?: string
}

export default function LiveChat({ instanceId, instanceStatus, agentName }: LiveChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId] = useState(() => `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isOnline = instanceStatus === 'RUNNING'
  const botName = agentName || 'AI Assistant'

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Welcome message
  useEffect(() => {
    if (messages.length === 0 && isOnline) {
      setMessages([{
        id: 'welcome',
        role: 'bot',
        text: `Hi! I'm ${botName}. How can I help you today?`,
        timestamp: new Date()
      }])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isLoading || !isOnline) return

    setError(null)
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date()
    }
    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/webchat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, message: text, sessionId })
      })
      const data = await res.json()

      if (data.error && !data.reply) {
        setError(data.error)
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'bot',
          text: data.reply || `Error: ${data.error}`,
          timestamp: new Date()
        }])
      } else {
        setMessages(prev => [...prev, {
          id: `bot-${Date.now()}`,
          role: 'bot',
          text: data.reply || 'No response received.',
          timestamp: new Date()
        }])
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'bot',
        text: 'Connection error. Please check if your instance is running.',
        timestamp: new Date()
      }])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }, [inputValue, isLoading, isOnline, instanceId, sessionId])

  const clearChat = () => {
    setMessages([{
      id: 'welcome',
      role: 'bot',
      text: `Hi! I'm ${botName}. How can I help you today?`,
      timestamp: new Date()
    }])
    setError(null)
  }

  const copyLastResponse = () => {
    const lastBot = [...messages].reverse().find(m => m.role === 'bot' && m.id !== 'welcome')
    if (lastBot) {
      navigator.clipboard.writeText(lastBot.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <Card className="flex flex-col h-[calc(100vh-220px)] min-h-[500px]">
      {/* Header */}
      <CardHeader className="pb-3 border-b shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <Bot className="h-5 w-5 text-purple-600" />
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                isOnline ? 'bg-green-500' : 'bg-gray-400'
              }`} />
            </div>
            <div>
              <CardTitle className="text-base">{botName}</CardTitle>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-xs text-gray-500">
                  {isOnline ? 'Online' : 'Offline'}
                </span>
                <span className="text-xs text-gray-400">
                  · Session {sessionId.slice(-6)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyLastResponse} title="Copy last response">
              {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearChat} title="Clear chat">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isOnline && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <WifiOff className="h-12 w-12 mb-3 opacity-50" />
            <p className="font-medium">Instance is offline</p>
            <p className="text-sm mt-1">Start your instance to use the chat.</p>
          </div>
        )}

        {isOnline && messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
              msg.role === 'user'
                ? 'bg-purple-600'
                : 'bg-gray-100'
            }`}>
              {msg.role === 'user' ? (
                <User className="h-3.5 w-3.5 text-white" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-purple-600" />
              )}
            </div>

            {/* Message bubble */}
            <div className={`max-w-[75%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
              <div
                className={`inline-block px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-md'
                    : 'bg-gray-100 text-gray-800 rounded-tl-md'
                }`}
              >
                {msg.text}
              </div>
              <p className={`text-[10px] text-gray-400 mt-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </CardContent>

      {/* Input */}
      <div className="border-t p-4 shrink-0 bg-white rounded-b-lg">
        {error && (
          <div className="mb-2 text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage() }}
          className="flex items-center gap-2"
        >
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isOnline ? 'Type a message...' : 'Instance is offline'}
            disabled={!isOnline || isLoading}
            className="flex-1 rounded-full border-gray-200 focus-visible:ring-purple-500"
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            className="rounded-full h-10 w-10 shrink-0 bg-purple-600 hover:bg-purple-700"
            disabled={!isOnline || isLoading || !inputValue.trim()}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        <p className="text-center text-[10px] text-gray-400 mt-2">
          Messages are sent via the OpenClaw gateway on your instance
        </p>
      </div>
    </Card>
  )
}
