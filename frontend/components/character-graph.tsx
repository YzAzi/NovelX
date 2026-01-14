"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d"

import {
  deleteGraphEntity,
  getCharacterGraph,
  mergeGraphEntities,
  updateGraphEntity,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import type {
  CharacterGraphLink,
  CharacterGraphNode,
  CharacterGraphResponse,
  EntityType,
} from "@/src/types/character-graph"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as typeof import("react-force-graph-2d").default

const ENTITY_COLORS: Record<string, string> = {
  character: "#3b82f6",
  location: "#10b981",
  item: "#f59e0b",
  organization: "#6366f1",
  event: "#ef4444",
  concept: "#8b5cf6",
  unknown: "#94a3b8",
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  character: "角色",
  location: "地点",
  item: "物品",
  organization: "组织",
  event: "事件",
  concept: "概念",
  unknown: "未知",
}

const RELATION_COLORS: Record<string, string> = {
  family: "#0ea5e9",
  friend: "#22c55e",
  enemy: "#ef4444",
  lover: "#ec4899",
  master_student: "#8b5cf6",
  colleague: "#14b8a6",
  belongs_to: "#f59e0b",
  located_at: "#10b981",
  participates_in: "#f97316",
  related_to: "#94a3b8",
  unknown: "#94a3b8",
}

function getRelationColor(relation?: string) {
  if (!relation) {
    return RELATION_COLORS.unknown
  }
  if (RELATION_COLORS[relation]) {
    return RELATION_COLORS[relation]
  }
  let hash = 0
  for (let i = 0; i < relation.length; i += 1) {
    hash = relation.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 45%)`
}

function buildNodeLabel(node: CharacterGraphNode) {
  const rows = [node.name]
  const normalizedType = normalizeEntityType(node.type)
  rows.push(`类型：${ENTITY_TYPE_LABELS[normalizedType]}`)
  if (node.aliases && node.aliases.length > 0) {
    rows.push(`别名：${node.aliases.join("、")}`)
  }
  if (node.description) {
    rows.push(`描述：${node.description}`)
  }
  return rows.join("\n")
}

function getEntityColor(entityType?: string) {
  if (!entityType) {
    return ENTITY_COLORS.unknown
  }
  return ENTITY_COLORS[entityType] ?? ENTITY_COLORS.unknown
}

function normalizeEntityType(type?: string) {
  if (type && ENTITY_COLORS[type]) {
    return type
  }
  return "unknown"
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  type?: EntityType
) {
  ctx.beginPath()
  if (type === "location") {
    ctx.rect(x - size, y - size, size * 2, size * 2)
  } else if (type === "item") {
    ctx.moveTo(x, y - size)
    ctx.lineTo(x + size, y)
    ctx.lineTo(x, y + size)
    ctx.lineTo(x - size, y)
    ctx.closePath()
  } else if (type === "organization") {
    const angle = Math.PI / 3
    ctx.moveTo(x + size, y)
    for (let i = 1; i <= 6; i += 1) {
      ctx.lineTo(x + size * Math.cos(angle * i), y + size * Math.sin(angle * i))
    }
  } else if (type === "event") {
    ctx.moveTo(x, y - size)
    ctx.lineTo(x + size, y + size)
    ctx.lineTo(x - size, y + size)
    ctx.closePath()
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2, false)
  }
}

export function CharacterGraph() {
  const { currentProject, graphUpdateVersion, setHighlightedNodes } = useProjectStore()
  const [graphData, setGraphData] = useState<CharacterGraphResponse>({
    nodes: [],
    links: [],
  })
  const graphDataRef = useRef(graphData)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const graphRef = useRef<
    | ForceGraphMethods<
        NodeObject<CharacterGraphNode>,
        LinkObject<CharacterGraphNode, CharacterGraphLink>
      >
    | undefined
  >(undefined)
  const [selectedEntity, setSelectedEntity] = useState<CharacterGraphNode | null>(null)
  const [selectedRelation, setSelectedRelation] = useState<CharacterGraphLink | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: CharacterGraphNode
  } | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeQuery, setMergeQuery] = useState("")
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [toasts, setToasts] = useState<
    Array<{ id: string; type: "success" | "error"; message: string }>
  >([])
  const [searchQuery, setSearchQuery] = useState("")
  const [filterTypes, setFilterTypes] = useState<Record<string, boolean>>({
    character: true,
    location: true,
    item: true,
    organization: true,
    event: true,
    concept: true,
    unknown: true,
  })
  const [filterRelations, setFilterRelations] = useState<Record<string, boolean>>({})
  const [pathEndpoints, setPathEndpoints] = useState({
    startId: "",
    endId: "",
  })
  const [pathRelations, setPathRelations] = useState<CharacterGraphLink[]>([])

  const measureContainer = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setGraphSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }
      const nextWidth = Math.floor(entry.contentRect.width)
      const nextHeight = Math.floor(entry.contentRect.height)
      if (nextWidth > 0 && nextHeight > 0) {
        setGraphSize({ width: nextWidth, height: nextHeight })
      }
    })

    observer.observe(container)
    const id = window.requestAnimationFrame(() => {
      measureContainer()
    })
    return () => {
      window.cancelAnimationFrame(id)
      observer.disconnect()
    }
  }, [measureContainer])

  useEffect(() => {
    graphDataRef.current = graphData
  }, [graphData])


  const loadGraph = useCallback(async () => {
    if (!currentProject) {
      setGraphData({ nodes: [], links: [] })
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const hasData = graphDataRef.current.nodes.length > 0
    if (hasData) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const response = await getCharacterGraph(currentProject.id, {
        signal: controller.signal,
      })
      setGraphData(response)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      setGraphData({ nodes: [], links: [] })
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [currentProject])

  useEffect(() => {
    loadGraph()
    return () => {
      abortRef.current?.abort()
    }
  }, [loadGraph, currentProject?.updated_at, graphUpdateVersion])

  const handleNodeClick = useCallback(
    (node: CharacterGraphNode) => {
      setSelectedRelation(null)
      setSelectedEntity(node)
      setHighlightedNodes(node.source_refs ?? [])
    },
    [setHighlightedNodes]
  )

  const handleBackgroundClick = useCallback(() => {
    setSelectedEntity(null)
    setSelectedRelation(null)
    setContextMenu(null)
    setHighlightedNodes([])
  }, [setHighlightedNodes])

  const handleNodeRightClick = useCallback(
    (node: CharacterGraphNode, event: MouseEvent) => {
      event.preventDefault()
      setContextMenu({ x: event.clientX, y: event.clientY, node })
      setMergeOpen(false)
      setMergeQuery("")
      setMergeTargetId("")
    },
    []
  )

  const handleNodeDoubleClick = useCallback((node: CharacterGraphNode) => {
    if (!graphRef.current || node.x == null || node.y == null) {
      return
    }
    graphRef.current.centerAt(node.x, node.y, 800)
    graphRef.current.zoom(2, 800)
  }, [])

  const handleLinkClick = useCallback((link: CharacterGraphLink) => {
    setSelectedEntity(null)
    setSelectedRelation(link)
  }, [])

  const relationTypes = useMemo(() => {
    const types = new Set<string>()
    graphData.links.forEach((link) => {
      types.add(link.relation_type ?? "related_to")
    })
    return Array.from(types)
  }, [graphData.links])

  useEffect(() => {
    setFilterRelations((prev) => {
      const next = { ...prev }
      relationTypes.forEach((type) => {
        if (next[type] === undefined) {
          next[type] = true
        }
      })
      return next
    })
  }, [relationTypes])

  const graphDataMemo = useMemo(() => {
    const allowedTypes = new Set(
      Object.entries(filterTypes)
        .filter(([, value]) => value)
        .map(([key]) => key)
    )
    const allowedRelations = new Set(
      Object.entries(filterRelations)
        .filter(([, value]) => value)
        .map(([key]) => key)
    )
    const filteredNodes = graphData.nodes.filter((node) => {
      const type = normalizeEntityType(node.type)
      return allowedTypes.has(type)
    })
    const nodeIds = new Set(filteredNodes.map((node) => node.id))
    const filteredLinks = graphData.links.filter((link) => {
      const relationType = link.relation_type ?? "related_to"
      if (allowedRelations.size > 0 && !allowedRelations.has(relationType)) {
        return false
      }
      return nodeIds.has(String(link.source)) && nodeIds.has(String(link.target))
    })
    return {
      nodes: filteredNodes,
      links: filteredLinks,
    }
  }, [filterTypes, filterRelations, graphData.links, graphData.nodes])

  useEffect(() => {
    if (graphDataMemo.nodes.length === 0) {
      return
    }
    if (graphSize.width > 0 && graphSize.height > 0) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      measureContainer()
      if (graphSize.width === 0 || graphSize.height === 0) {
        const fallbackWidth = Math.max(640, Math.floor(window.innerWidth * 0.7))
        const fallbackHeight = Math.max(420, Math.floor(window.innerHeight * 0.6))
        setGraphSize({ width: fallbackWidth, height: fallbackHeight })
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [graphDataMemo.nodes.length, graphSize.height, graphSize.width, measureContainer])

  useEffect(() => {
    if (!graphRef.current || graphDataMemo.nodes.length === 0) {
      return
    }
    if (graphSize.width === 0 || graphSize.height === 0) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      graphRef.current?.zoomToFit(500, 60)
    })
    return () => window.cancelAnimationFrame(id)
  }, [graphDataMemo.nodes.length, graphSize.height, graphSize.width])

  useEffect(() => {
    if (!graphRef.current || graphDataMemo.nodes.length === 0) {
      return
    }
    graphRef.current.d3Force("charge")?.strength(-900)
    graphRef.current.d3Force("link")?.distance(200)
    graphRef.current.d3Force("collide")?.radius(68).strength(0.98)
  }, [graphDataMemo.nodes.length])

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) {
      return new Set<string>()
    }
    const query = searchQuery.toLowerCase()
    return new Set(
      graphData.nodes
        .filter(
          (node) =>
            node.name.toLowerCase().includes(query) ||
            (node.aliases ?? []).some((alias) => alias.toLowerCase().includes(query))
        )
        .map((node) => node.id)
    )
  }, [graphData.nodes, searchQuery])

  const pathNodeIds = useMemo(() => {
    const ids = new Set<string>()
    pathRelations.forEach((link) => {
      ids.add(String(link.source))
      ids.add(String(link.target))
    })
    return ids
  }, [pathRelations])

  const handlePathFind = useCallback(() => {
    if (!pathEndpoints.startId || !pathEndpoints.endId) {
      setPathRelations([])
      return
    }
    const adjacency = new Map<string, CharacterGraphLink[]>()
    graphData.links.forEach((link) => {
      const source = String(link.source)
      const target = String(link.target)
      adjacency.set(source, [...(adjacency.get(source) ?? []), link])
      adjacency.set(target, [...(adjacency.get(target) ?? []), link])
    })

    const queue: Array<{ id: string; path: CharacterGraphLink[] }> = [
      { id: pathEndpoints.startId, path: [] },
    ]
    const visited = new Set<string>([pathEndpoints.startId])

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break
      if (current.id === pathEndpoints.endId) {
        setPathRelations(current.path)
        return
      }
      for (const relation of adjacency.get(current.id) ?? []) {
        const nextId =
          String(relation.source) === current.id
            ? String(relation.target)
            : String(relation.source)
        if (visited.has(nextId)) {
          continue
        }
        visited.add(nextId)
        queue.push({ id: nextId, path: [...current.path, relation] })
      }
    }
    setPathRelations([])
  }, [graphData.links, pathEndpoints.endId, pathEndpoints.startId])

  const pushToast = useCallback((type: "success" | "error", message: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, type, message }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 3000)
  }, [])

  const handleEditEntity = useCallback(async () => {
    if (!currentProject || !contextMenu) {
      return
    }
    const name = window.prompt("编辑实体名称", contextMenu.node.name)
    if (name === null) {
      return
    }
    const description = window.prompt(
      "编辑实体描述",
      contextMenu.node.description ?? ""
    )
    if (description === null) {
      return
    }
    setIsMutating(true)
    try {
      await updateGraphEntity(currentProject.id, contextMenu.node.id, {
        name,
        description,
      })
      await loadGraph()
      setSelectedEntity((prev) =>
        prev?.id === contextMenu.node.id
          ? { ...prev, name, description }
          : prev
      )
      pushToast("success", "实体已更新")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "实体更新失败"
      pushToast("error", message)
    } finally {
      setIsMutating(false)
      setContextMenu(null)
    }
  }, [contextMenu, currentProject, loadGraph, pushToast])

  const handleMergeEntity = useCallback(async () => {
    if (!currentProject || !contextMenu) {
      return
    }
    if (!mergeTargetId) {
      pushToast("error", "请选择要合并的目标实体")
      return
    }
    const target = graphData.nodes.find((node) => node.id === mergeTargetId)
    const confirmed = window.confirm(
      `确认将「${contextMenu.node.name}」合并到「${target?.name ?? "目标实体"}」吗？`
    )
    if (!confirmed) {
      return
    }
    setIsMutating(true)
    try {
      await mergeGraphEntities(
        currentProject.id,
        contextMenu.node.id,
        mergeTargetId
      )
      await loadGraph()
      setSelectedEntity(null)
      pushToast("success", "实体合并完成")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "实体合并失败"
      pushToast("error", message)
    } finally {
      setIsMutating(false)
      setContextMenu(null)
    }
  }, [contextMenu, currentProject, graphData.nodes, loadGraph, mergeTargetId, pushToast])

  const handleDeleteEntity = useCallback(async () => {
    if (!currentProject || !contextMenu) {
      return
    }
    const confirmed = window.confirm(
      `确认删除实体「${contextMenu.node.name}」及其关系吗？`
    )
    if (!confirmed) {
      return
    }
    setIsMutating(true)
    try {
      await deleteGraphEntity(currentProject.id, contextMenu.node.id)
      await loadGraph()
      setSelectedEntity(null)
      pushToast("success", "实体已删除")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "实体删除失败"
      pushToast("error", message)
    } finally {
      setIsMutating(false)
      setContextMenu(null)
    }
  }, [contextMenu, currentProject, loadGraph, pushToast])

  const mergeOptions = useMemo(() => {
    if (!contextMenu) {
      return []
    }
    const keyword = mergeQuery.trim().toLowerCase()
    return graphData.nodes
      .filter((node) => node.id !== contextMenu.node.id)
      .filter((node) =>
        keyword
          ? node.name.toLowerCase().includes(keyword) ||
            (node.aliases ?? []).some((alias) =>
              alias.toLowerCase().includes(keyword)
            )
          : true
      )
      .slice(0, 8)
  }, [contextMenu, graphData.nodes, mergeQuery])

  const drawLinkLabel = useCallback(
    (link: CharacterGraphLink, ctx: CanvasRenderingContext2D) => {
      const relation = link.relation_name ?? link.relation_type
      if (!relation) {
        return
      }
      const source = typeof link.source === "string" ? null : link.source
      const target = typeof link.target === "string" ? null : link.target
      if (source?.x == null || source?.y == null || target?.x == null || target?.y == null) {
        return
      }

      const x = (source.x + target.x) / 2
      const y = (source.y + target.y) / 2
      ctx.save()
      ctx.font = "11px sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      const textWidth = ctx.measureText(relation).width
      const paddingX = 6
      const paddingY = 3
      const boxWidth = textWidth + paddingX * 2
      const boxHeight = 14 + paddingY
      ctx.fillStyle = "rgba(248, 250, 252, 0.92)"
      ctx.strokeStyle = "rgba(148, 163, 184, 0.6)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = "#475569"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(relation, x, y)
      ctx.restore()
    },
    []
  )

  if (!currentProject) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed bg-white/80 text-sm text-muted-foreground shadow-sm">
        先生成大纲，再查看角色关系。
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border bg-white/80 text-sm text-muted-foreground shadow-sm">
        正在加载角色关系...
      </div>
    )
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed bg-white/80 text-sm text-muted-foreground shadow-sm">
        暂无角色关系数据
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[420px] overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/80 shadow-[0_20px_60px_rgba(15,23,42,0.08)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_45%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.12),_transparent_42%)]" />
      {isRefreshing ? (
        <div className="absolute right-4 top-4 z-10 rounded-full border border-white/70 bg-white/90 px-3 py-1 text-xs text-slate-500 shadow">
          更新中...
        </div>
      ) : null}
      <ForceGraph2D
        ref={graphRef}
        graphData={graphDataMemo}
        width={graphSize.width}
        height={graphSize.height}
        nodeLabel={buildNodeLabel}
        nodeRelSize={4}
        nodeCanvasObject={(node, ctx) => {
          const graphNode = node as CharacterGraphNode & { x?: number; y?: number }
          if (graphNode.x == null || graphNode.y == null) {
            return
          }
          const normalizedType = normalizeEntityType(graphNode.type)
          const size = graphNode.id === selectedEntity?.id ? 8 : 5
          const isMatch = searchMatches.has(graphNode.id)
          const isPath = pathNodeIds.has(graphNode.id)
          ctx.save()
          ctx.shadowColor = "rgba(15, 23, 42, 0.18)"
          ctx.shadowBlur = graphNode.id === selectedEntity?.id ? 14 : 8
          ctx.shadowOffsetY = 2
          ctx.fillStyle = getEntityColor(normalizedType as EntityType)
          if (isPath) {
            ctx.fillStyle = "#f97316"
          }
          drawShape(ctx, graphNode.x, graphNode.y, size, graphNode.type)
          ctx.fill()
          if (isMatch || isPath || graphNode.id === selectedEntity?.id) {
            ctx.lineWidth = 2
            ctx.strokeStyle = isMatch ? "#facc15" : "#2563eb"
            ctx.stroke()
          }
          ctx.shadowBlur = 0
          ctx.font = "9px sans-serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          const label = graphNode.name
          const labelWidth = ctx.measureText(label).width
          const labelPadding = 2
          const labelX = graphNode.x - labelWidth / 2 - labelPadding
          const labelY = graphNode.y + 9
          const labelHeight = 12
          ctx.fillStyle = "rgba(248, 250, 252, 0.96)"
          ctx.strokeStyle = "rgba(148, 163, 184, 0.7)"
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(labelX, labelY, labelWidth + labelPadding * 2, labelHeight)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = "#0f172a"
          ctx.fillText(label, graphNode.x, graphNode.y + 10)
          ctx.restore()
        }}
        linkColor={(link) =>
          getRelationColor((link as CharacterGraphLink).relation_type)
        }
        linkWidth={(link) =>
          pathRelations.includes(link as CharacterGraphLink) ? 2.4 : 1.2
        }
        linkDirectionalParticles={0}
        linkCanvasObject={drawLinkLabel}
        linkCanvasObjectMode={() => "after"}
        onNodeClick={(node, event) => {
          handleNodeClick(node as CharacterGraphNode)
          if (event.detail >= 2) {
            handleNodeDoubleClick(node as CharacterGraphNode)
          }
        }}
        onNodeRightClick={(node, event) =>
          handleNodeRightClick(node as CharacterGraphNode, event)
        }
        onLinkClick={(link) => handleLinkClick(link as CharacterGraphLink)}
        onBackgroundClick={handleBackgroundClick}
        cooldownTicks={100}
      />
      {graphData.nodes.length > 0 && graphDataMemo.nodes.length === 0 ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          当前筛选条件下无可视节点
        </div>
      ) : null}
      {graphDataMemo.nodes.length > 0 && (graphSize.width === 0 || graphSize.height === 0) ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          正在加载画布...
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="absolute z-20 w-40 rounded-md border border-white/70 bg-white/95 p-2 text-xs shadow-lg backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="mb-2 text-[11px] font-semibold text-slate-500">
            {contextMenu.node.name}
          </div>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left hover:bg-slate-100"
            onClick={handleEditEntity}
            disabled={isMutating}
          >
            编辑实体
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left hover:bg-slate-100"
            onClick={() => setMergeOpen((prev) => !prev)}
            disabled={isMutating}
          >
            合并实体
          </button>
          {mergeOpen ? (
            <div className="mt-2 space-y-2 rounded-md border border-dashed p-2">
              <input
                value={mergeQuery}
                onChange={(event) => setMergeQuery(event.target.value)}
                placeholder="搜索目标实体"
                className="w-full rounded border px-2 py-1 text-[11px]"
              />
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {mergeOptions.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left text-[11px] ${
                      mergeTargetId === node.id ? "bg-blue-50 text-blue-600" : "hover:bg-slate-100"
                    }`}
                    onClick={() => setMergeTargetId(node.id)}
                  >
                    <div className="font-medium">{node.name}</div>
                    <div className="text-[10px] text-slate-500">
                      {node.type ?? "unknown"}
                      {node.description
                        ? ` · ${node.description.slice(0, 14)}${node.description.length > 14 ? "..." : ""}`
                        : ""}
                    </div>
                  </button>
                ))}
                {mergeOptions.length === 0 ? (
                  <div className="text-[11px] text-slate-400">无匹配实体</div>
                ) : null}
              </div>
              <button
                type="button"
                className="w-full rounded bg-slate-900 px-2 py-1 text-[11px] text-white"
                onClick={handleMergeEntity}
                disabled={isMutating}
              >
                确认合并
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50"
            onClick={handleDeleteEntity}
            disabled={isMutating}
          >
            删除实体
          </button>
        </div>
      ) : null}
      <div className="absolute left-4 top-4 z-10 w-[280px] space-y-3 rounded-2xl border border-white/70 bg-white/90 p-3 text-xs shadow-lg backdrop-blur">
        <div>
          <div className="text-[11px] font-semibold text-slate-500">搜索实体</div>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="输入名称或别名"
            className="mt-1 w-full rounded-md border border-slate-200/80 bg-white/95 px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500">实体类型筛选</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {Object.keys(filterTypes).map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-[11px] text-slate-600 transition hover:border-slate-200 hover:bg-white/80"
              >
                <input
                  type="checkbox"
                  checked={filterTypes[type]}
                  className="accent-slate-800"
                  onChange={(event) =>
                    setFilterTypes((prev) => ({
                      ...prev,
                      [type]: event.target.checked,
                    }))
                  }
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: ENTITY_COLORS[type] ?? "#94a3b8" }}
                />
                {ENTITY_TYPE_LABELS[type] ?? type}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500">关系类型筛选</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {relationTypes.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-[11px] text-slate-600 transition hover:border-slate-200 hover:bg-white/80"
              >
                <input
                  type="checkbox"
                  checked={filterRelations[type] ?? true}
                  className="accent-slate-800"
                  onChange={(event) =>
                    setFilterRelations((prev) => ({
                      ...prev,
                      [type]: event.target.checked,
                    }))
                  }
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: getRelationColor(type) }}
                />
                {type}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500">路径查找</div>
          <div className="mt-1 flex flex-col gap-1">
            <select
              className="rounded border border-slate-200/80 bg-white/95 px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={pathEndpoints.startId}
              onChange={(event) =>
                setPathEndpoints((prev) => ({
                  ...prev,
                  startId: event.target.value,
                }))
              }
            >
              <option value="">选择起点</option>
              {graphData.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-slate-200/80 bg-white/95 px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={pathEndpoints.endId}
              onChange={(event) =>
                setPathEndpoints((prev) => ({
                  ...prev,
                  endId: event.target.value,
                }))
              }
            >
              <option value="">选择终点</option>
              {graphData.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow transition hover:bg-slate-800"
              onClick={handlePathFind}
            >
              查找路径
            </button>
          </div>
          {pathRelations.length > 0 ? (
            <div className="mt-2 space-y-1 text-[11px] text-slate-600">
              {pathRelations.map((relation, index) => {
                const sourceLabel =
                  typeof relation.source === "string"
                    ? relation.source
                    : relation.source?.name ?? relation.source?.id ?? "?"
                const targetLabel =
                  typeof relation.target === "string"
                    ? relation.target
                    : relation.target?.name ?? relation.target?.id ?? "?"
                return (
                  <div key={`${sourceLabel}-${targetLabel}-${index}`}>
                    {relation.relation_name ?? relation.relation_type ?? "关系"}：{sourceLabel} → {targetLabel}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
      {selectedEntity ? (
        <div className="absolute right-4 top-4 z-10 w-[280px] rounded-2xl border border-white/70 bg-white/90 p-3 text-xs shadow-lg backdrop-blur">
          <div className="text-sm font-semibold text-slate-900">
            {selectedEntity.name}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            类型：{ENTITY_TYPE_LABELS[normalizeEntityType(selectedEntity.type)]}
          </div>
          <div className="mt-2 text-[11px] text-slate-600">
            {selectedEntity.description || "暂无描述"}
          </div>
          {selectedEntity.properties ? (
            <div className="mt-2 text-[11px] text-slate-500">
              属性：{JSON.stringify(selectedEntity.properties)}
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-slate-500">
            相关节点：{selectedEntity.source_refs?.length ?? 0}
          </div>
        </div>
      ) : null}
      {selectedRelation ? (
        <div className="absolute right-4 bottom-4 z-10 w-[280px] rounded-2xl border border-white/70 bg-white/90 p-3 text-xs shadow-lg backdrop-blur">
          <div className="text-sm font-semibold text-slate-900">
            {selectedRelation.relation_name ?? "关系"}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            类型：{selectedRelation.relation_type ?? "related_to"}
          </div>
          <div className="mt-2 text-[11px] text-slate-600">
            {selectedRelation.description || "暂无描述"}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            关联：
            {typeof selectedRelation.source === "string"
              ? selectedRelation.source
              : selectedRelation.source?.name ?? selectedRelation.source?.id ?? "?"}{" "}
            →{" "}
            {typeof selectedRelation.target === "string"
              ? selectedRelation.target
              : selectedRelation.target?.name ?? selectedRelation.target?.id ?? "?"}
          </div>
        </div>
      ) : null}
      {toasts.length > 0 ? (
        <div className="absolute right-4 top-4 z-20 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-md border px-3 py-2 text-xs shadow-lg ${
                toast.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
