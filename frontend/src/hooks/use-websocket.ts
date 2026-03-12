"use client"

import { useEffect, useRef } from "react"

import type { Conflict, StoryNode } from "@/src/types/models"
import { getAuthToken } from "@/src/lib/api"
import { WebSocketClient } from "@/src/lib/websocket"
import { useProjectStore } from "@/src/stores/project-store"

type NodeUpdatedPayload = { node?: StoryNode }
type SyncPayload = { details?: { node_id?: string; request_id?: string } }

export function useWebsocket(projectId: string | null) {
  const clientRef = useRef<WebSocketClient | null>(null)
  const syncRequestIdRef = useRef<string | null>(null)
  const selectedNodeIdRef = useRef<string | null>(null)
  const {
    addConflict,
    clearConflicts,
    syncRequestId,
    selectedNodeId,
    setSyncNodeId,
    setSyncRequestId,
    setSyncStatus,
    setWsStatus,
    updateGraphFromServer,
    updateNodeFromServer,
  } = useProjectStore()

  useEffect(() => {
    syncRequestIdRef.current = syncRequestId
  }, [syncRequestId])

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId
  }, [selectedNodeId])

  useEffect(() => {
    if (!projectId) {
      clientRef.current?.disconnect()
      return
    }

    if (!clientRef.current) {
      clientRef.current = new WebSocketClient()
    }

    clearConflicts()
    const client = clientRef.current
    client.connect(projectId, getAuthToken())

    const unsubscribeStatus = client.onStatus((status) => {
      setWsStatus(status)
    })

    const unsubscribeNode = client.on("node_updated", (payload) => {
      const data = payload as NodeUpdatedPayload
      if (data?.node) {
        updateNodeFromServer(data.node)
      }
    })

    const unsubscribeGraph = client.on("graph_updated", (payload) => {
      updateGraphFromServer(payload)
    })

    const unsubscribeConflict = client.on("conflict_detected", (payload) => {
      const data = payload as { conflicts?: Conflict[] }
      if (data?.conflicts) {
        data.conflicts.forEach((conflict) => addConflict(conflict))
      }
    })

    const shouldHandleSync = (payload: SyncPayload) => {
      const nodeId = payload?.details?.node_id
      const requestId = payload?.details?.request_id
      if (syncRequestIdRef.current) {
        return requestId === syncRequestIdRef.current
      }
      if (requestId) {
        return false
      }
      if (!nodeId) {
        return false
      }
      return nodeId === selectedNodeIdRef.current
    }

    const unsubscribeSyncStart = client.on("sync_started", (payload) => {
      if (!shouldHandleSync(payload as SyncPayload)) {
        return
      }
      const nodeId = (payload as SyncPayload)?.details?.node_id ?? null
      if (nodeId) {
        setSyncNodeId(nodeId)
      }
      setSyncStatus("syncing")
    })

    const unsubscribeSyncCompleted = client.on("sync_completed", (payload) => {
      if (!shouldHandleSync(payload as SyncPayload)) {
        return
      }
      const nodeId = (payload as SyncPayload)?.details?.node_id ?? null
      if (nodeId) {
        setSyncNodeId(nodeId)
      }
      setSyncStatus("completed")
      setSyncRequestId(null)
    })

    const unsubscribeSyncFailed = client.on("sync_failed", (payload) => {
      if (!shouldHandleSync(payload as SyncPayload)) {
        return
      }
      const nodeId = (payload as SyncPayload)?.details?.node_id ?? null
      if (nodeId) {
        setSyncNodeId(nodeId)
      }
      setSyncStatus("failed")
      setSyncRequestId(null)
    })

    return () => {
      unsubscribeNode()
      unsubscribeGraph()
      unsubscribeConflict()
      unsubscribeSyncStart()
      unsubscribeSyncCompleted()
      unsubscribeSyncFailed()
      unsubscribeStatus()
      client.disconnect()
    }
  }, [
    addConflict,
    clearConflicts,
    projectId,
    setSyncNodeId,
    setSyncRequestId,
    setSyncStatus,
    setWsStatus,
    updateGraphFromServer,
    updateNodeFromServer,
  ])
}
