"use client"

type MessageHandler = (payload: unknown) => void
type StatusHandler = (status: "connected" | "disconnected" | "reconnecting") => void

type HandlerMap = Map<string, Set<MessageHandler>>

export class WebSocketClient {
  private socket: WebSocket | null = null
  private handlers: HandlerMap = new Map()
  private heartbeatTimer: number | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempts = 0
  private shouldReconnect = true
  private statusHandlers: Set<StatusHandler> = new Set()

  connect(
    channelId: string,
    token?: string | null,
    options: { route?: "project" | "outline" } = {},
  ) {
    if (this.socket) {
      this.disconnect()
    }

    const baseUrl = this.getWsBaseUrl()
    if (!baseUrl) {
      return
    }

    const query = token ? `?token=${encodeURIComponent(token)}` : ""
    const routePrefix = options.route === "outline" ? "/ws/outline" : "/ws"
    const url = `${baseUrl}${routePrefix}/${encodeURIComponent(channelId)}${query}`
    this.shouldReconnect = true
    this.socket = new WebSocket(url)

    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      this.emitStatus("connected")
      this.startHeartbeat()
    }

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type?: string
          payload?: unknown
        }
        if (!message.type) {
          return
        }
        if (message.type === "ping") {
          this.send({ type: "pong", payload: {} })
          return
        }
        this.emit(message.type, message.payload)
      } catch {
        // ignore malformed messages
      }
    }

    this.socket.onclose = () => {
      this.stopHeartbeat()
      this.emitStatus("disconnected")
      this.scheduleReconnect(channelId, token ?? null, options)
    }

    this.socket.onerror = () => {
      this.stopHeartbeat()
      this.emitStatus("disconnected")
      this.scheduleReconnect(channelId, token ?? null, options)
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  on(messageType: string, handler: MessageHandler) {
    const set = this.handlers.get(messageType) ?? new Set<MessageHandler>()
    set.add(handler)
    this.handlers.set(messageType, set)
    return () => {
      set.delete(handler)
      if (set.size === 0) {
        this.handlers.delete(messageType)
      }
    }
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  private emit(messageType: string, payload: unknown) {
    const handlers = this.handlers.get(messageType)
    if (!handlers) {
      return
    }
    handlers.forEach((handler) => handler(payload))
  }

  private send(payload: { type: string; payload: unknown }) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload))
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "ping", payload: {} })
    }, 30000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(
    channelId: string,
    token: string | null,
    options: { route?: "project" | "outline" },
  ) {
    if (!this.shouldReconnect) {
      return
    }
    if (this.reconnectAttempts >= 5) {
      this.emitStatus("reconnecting")
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer)
      }
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectAttempts = 0
        this.connect(channelId, token, options)
      }, 60000)
      return
    }
    this.emitStatus("reconnecting")
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)
    this.reconnectAttempts += 1
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.connect(channelId, token, options)
    }, delay)
  }

  private getWsBaseUrl() {
    if (typeof window === "undefined") {
      return ""
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (apiUrl && apiUrl.startsWith("http")) {
      return apiUrl.replace("http://", "ws://").replace("https://", "wss://")
    }
    return window.location.origin.replace("http://", "ws://").replace("https://", "wss://")
  }

  private emitStatus(status: "connected" | "disconnected" | "reconnecting") {
    this.statusHandlers.forEach((handler) => handler(status))
  }
}
