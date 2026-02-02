"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d"

import {
  createGraphEntity,
  deleteGraphEntity,
  deleteGraphRelation,
  getCharacterGraph,
  mergeGraphEntities,
  updateGraphEntity,
  updateGraphRelation,
} from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import type {
  CharacterGraphLink,
  CharacterGraphNode,
  CharacterGraphResponse,
  EntityType,
} from "@/src/types/character-graph"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as typeof import("react-force-graph-2d").default

const ENTITY_TYPE_LABELS: Record<string, string> = {
  character: "角色",
  location: "地点",
  item: "物品",
  organization: "组织",
  event: "事件",
  concept: "概念",
  unknown: "未知",
}

type GraphPalette = {
  background: string
  card: string
  border: string
  foreground: string
  muted: string
  primary: string
  accent: string
  destructive: string
  chart: string[]
  entity: Record<string, string>
}

const createFallbackPalette = (): GraphPalette => {
  const fallback = "currentColor"
  return {
    background: fallback,
    card: fallback,
    border: fallback,
    foreground: fallback,
    muted: fallback,
    primary: fallback,
    accent: fallback,
    destructive: fallback,
    chart: [fallback, fallback, fallback, fallback, fallback],
    entity: {
      character: fallback,
      location: fallback,
      item: fallback,
      organization: fallback,
      event: fallback,
      concept: fallback,
      unknown: fallback,
    },
  }
}

const getGraphPalette = (): GraphPalette => {
  if (typeof window === "undefined") {
    return createFallbackPalette()
  }

  const styles = getComputedStyle(document.documentElement)
  const base = styles.color?.trim() || "currentColor"
  const readVar = (name: string) => styles.getPropertyValue(name).trim() || base

  const chart = [
    readVar("--chart-1"),
    readVar("--chart-2"),
    readVar("--chart-3"),
    readVar("--chart-4"),
    readVar("--chart-5"),
  ]

  const palette: GraphPalette = {
    background: readVar("--background"),
    card: readVar("--card"),
    border: readVar("--border"),
    foreground: readVar("--foreground"),
    muted: readVar("--muted-foreground"),
    primary: readVar("--primary"),
    accent: readVar("--accent-foreground"),
    destructive: readVar("--destructive"),
    chart,
    entity: {
      character: chart[0],
      location: chart[1],
      item: chart[2],
      organization: chart[3],
      event: chart[4],
      concept: readVar("--accent-foreground"),
      unknown: readVar("--muted-foreground"),
    },
  }

  return palette
}

const RELATION_COLOR_INDEX: Record<string, number> = {
  family: 1,
  friend: 2,
  enemy: -1,
  lover: 0,
  master_student: 3,
  colleague: 4,
  belongs_to: 3,
  located_at: 1,
  participates_in: 2,
  related_to: -2,
  unknown: -2,
}

function getRelationColor(
  relation: string | undefined,
  palette: GraphPalette
) {
  if (!relation) {
    return palette.muted
  }
  const index = RELATION_COLOR_INDEX[relation]
  if (index === -1) {
    return palette.destructive
  }
  if (index === -2) {
    return palette.muted
  }
  if (typeof index === "number") {
    return palette.chart[index % palette.chart.length]
  }
  let hash = 0
  for (let i = 0; i < relation.length; i += 1) {
    hash = relation.charCodeAt(i) + ((hash << 5) - hash)
  }
  const fallbackIndex = Math.abs(hash) % palette.chart.length
  return palette.chart[fallbackIndex]
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

function normalizeEntityType(type?: string) {
  if (type && ENTITY_TYPE_LABELS[type]) {
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
  const [graphInstanceKey, setGraphInstanceKey] = useState(0)
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
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    type: "character" as EntityType,
    aliases: "",
    properties: "",
  })
  const [createError, setCreateError] = useState<string | null>(null)
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
  const [palette, setPalette] = useState<GraphPalette>(() => getGraphPalette())
  const [editRelationOpen, setEditRelationOpen] = useState(false)
  const [editRelationForm, setEditRelationForm] = useState<{
    id: string
    relation_type: string
    relation_name: string
    description: string
  }>({
    id: "",
    relation_type: "",
    relation_name: "",
    description: "",
  })

  const fitOnceRef = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const updatePalette = () => setPalette(getGraphPalette())
    updatePalette()

    const observer = new MutationObserver(() => updatePalette())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener?.("change", updatePalette)

    return () => {
      observer.disconnect()
      media.removeEventListener?.("change", updatePalette)
    }
  }, [])

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

  useLayoutEffect(() => {
    let cancelled = false
    let attempt = 0
    const tick = () => {
      if (cancelled) {
        return
      }
      measureContainer()
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0 && rect.height > 0) {
        return
      }
      attempt += 1
      if (attempt < 6) {
        window.requestAnimationFrame(tick)
      }
    }
    const id = window.requestAnimationFrame(tick)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [measureContainer])

  const handleGraphRef = useCallback(
    (
      instance:
        | ForceGraphMethods<
            NodeObject<CharacterGraphNode>,
            LinkObject<CharacterGraphNode, CharacterGraphLink>
          >
        | null
    ) => {
      graphRef.current = instance ?? undefined
      if (instance) {
        setGraphInstanceKey((prev) => prev + 1)
      }
    },
    []
  )

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

  const isGraphReady = graphSize.width > 0 && graphSize.height > 0

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
    if (!isGraphReady) {
      return
    }
    fitOnceRef.current = false
    const id = window.requestAnimationFrame(() => {
      graphRef.current?.zoomToFit(500, 60)
    })
    return () => window.cancelAnimationFrame(id)
  }, [graphDataMemo.nodes.length, graphInstanceKey, isGraphReady])

  const handleEngineStop = useCallback(() => {
    if (!graphRef.current || !isGraphReady || fitOnceRef.current) {
      return
    }
    fitOnceRef.current = true
    graphRef.current.zoomToFit(500, 60)
  }, [isGraphReady])

  useEffect(() => {
    if (!graphRef.current || graphDataMemo.nodes.length === 0 || !isGraphReady) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      graphRef.current?.d3Force("charge")?.strength(-450)
      graphRef.current?.d3Force("link")?.distance(100)
      graphRef.current?.d3Force("collide")?.radius(34).strength(0.98)
    })
    return () => window.cancelAnimationFrame(id)
  }, [graphDataMemo.nodes.length, graphInstanceKey, isGraphReady])

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
      const source = typeof link.source === "string" ? link.source : link.source.id
      const target = typeof link.target === "string" ? link.target : link.target.id
      ids.add(source)
      ids.add(target)
    })
    return ids
  }, [pathRelations])

  const handlePathFind = useCallback(() => {
    if (!pathEndpoints.startId || !pathEndpoints.endId) {
      setPathRelations([])
      return
    }
    const getNodeId = (value: string | CharacterGraphNode) =>
      typeof value === "string" ? value : value.id
    const adjacency = new Map<string, CharacterGraphLink[]>()
    graphData.links.forEach((link) => {
      const source = getNodeId(link.source)
      const target = getNodeId(link.target)
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
          getNodeId(relation.source) === current.id
            ? getNodeId(relation.target)
            : getNodeId(relation.source)
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

  const [propertyRows, setPropertyRows] = useState<
    Array<{ key: string; value: string }>
  >([])

  const handleAddPropertyRow = () => {
    setPropertyRows((prev) => [...prev, { key: "", value: "" }])
  }

  const handleRemovePropertyRow = (index: number) => {
    setPropertyRows((prev) => prev.filter((_, i) => i !== index))
  }

  const handlePropertyChange = (
    index: number,
    field: "key" | "value",
    value: string
  ) => {
    setPropertyRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  const handleCreateEntity = useCallback(async () => {
    if (!currentProject) {
      return
    }
    const name = createForm.name.trim()
    if (!name) {
      setCreateError("请填写角色名称")
      return
    }

    const properties: Record<string, unknown> = {}
    for (const row of propertyRows) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (key) {
        if (value === "true") properties[key] = true
        else if (value === "false") properties[key] = false
        else if (!Number.isNaN(Number(value)) && value !== "") properties[key] = Number(value)
        else properties[key] = value
      }
    }

    const aliases = createForm.aliases
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    setIsMutating(true)
    setCreateError(null)
    try {
      const entity = await createGraphEntity(currentProject.id, {
        name,
        description: createForm.description.trim(),
        type: createForm.type,
        aliases,
        properties: Object.keys(properties).length > 0 ? properties : undefined,
      })
      await loadGraph()
      setSelectedEntity(entity)
      pushToast("success", "角色已创建")
      setCreateOpen(false)
      setCreateForm({
        name: "",
        description: "",
        type: "character",
        aliases: "",
        properties: "",
      })
      setPropertyRows([])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "角色创建失败"
      setCreateError(message)
      pushToast("error", message)
    } finally {
      setIsMutating(false)
    }
  }, [createForm, currentProject, loadGraph, propertyRows, pushToast])

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

  const handleEditRelation = useCallback(() => {
    if (!selectedRelation || !selectedRelation.id) return
    setEditRelationForm({
      id: selectedRelation.id,
      relation_type: selectedRelation.relation_type ?? "related_to",
      relation_name: selectedRelation.relation_name ?? "",
      description: selectedRelation.description ?? "",
    })
    setEditRelationOpen(true)
  }, [selectedRelation])

  const handleUpdateRelation = useCallback(async () => {
    if (!currentProject || !editRelationForm.id) return
    setIsMutating(true)
    try {
      await updateGraphRelation(currentProject.id, editRelationForm.id, {
        relation_type: editRelationForm.relation_type,
        relation_name: editRelationForm.relation_name,
        description: editRelationForm.description,
      })
      await loadGraph()
      setEditRelationOpen(false)
      setSelectedRelation(null)
      pushToast("success", "关系已更新")
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新关系失败"
      pushToast("error", message)
    } finally {
      setIsMutating(false)
    }
  }, [currentProject, editRelationForm, loadGraph, pushToast])

  const handleDeleteRelation = useCallback(async () => {
    if (!currentProject || !selectedRelation || !selectedRelation.id) return
    const confirmed = window.confirm("确认删除这条关系吗？")
    if (!confirmed) return

    setIsMutating(true)
    try {
      await deleteGraphRelation(currentProject.id, selectedRelation.id)
      await loadGraph()
      setSelectedRelation(null)
      pushToast("success", "关系已删除")
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除关系失败"
      pushToast("error", message)
    } finally {
      setIsMutating(false)
    }
  }, [currentProject, selectedRelation, loadGraph, pushToast])

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
      ctx.fillStyle = palette.card
      ctx.strokeStyle = palette.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = palette.muted
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(relation, x, y)
      ctx.restore()
    },
    [palette]
  )

  if (!currentProject) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-background text-sm text-muted-foreground">
        先生成大纲，再查看角色关系。
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-border bg-background text-sm text-muted-foreground">
        正在加载角色关系...
      </div>
    )
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-background text-sm text-muted-foreground">
        暂无角色关系数据
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-border bg-background"
    >
      {isRefreshing ? (
        <div className="absolute right-4 top-4 z-10 rounded-full border border-border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          更新中...
        </div>
      ) : null}
      <ForceGraph2D
        ref={handleGraphRef as any}
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
          const baseColor =
            palette.entity[normalizedType] ?? palette.entity.unknown

          ctx.save()
          ctx.fillStyle = isPath ? palette.chart[4] : baseColor
          drawShape(ctx, graphNode.x, graphNode.y, size, graphNode.type)
          ctx.fill()

          if (isMatch || isPath || graphNode.id === selectedEntity?.id) {
            ctx.lineWidth = 2
            ctx.strokeStyle = isMatch ? palette.accent : palette.primary
            ctx.stroke()
          }

          ctx.font = "10px sans-serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "top"
          const label = graphNode.name
          const labelWidth = ctx.measureText(label).width
          const labelPadding = 2
          const labelX = graphNode.x - labelWidth / 2 - labelPadding
          const labelY = graphNode.y + 9
          const labelHeight = 12
          ctx.fillStyle = palette.card
          ctx.strokeStyle = palette.border
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(labelX, labelY, labelWidth + labelPadding * 2, labelHeight)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = palette.foreground
          ctx.fillText(label, graphNode.x, graphNode.y + 10)
          ctx.restore()
        }}
        linkColor={(link) =>
          getRelationColor((link as CharacterGraphLink).relation_type, palette)
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
        onEngineStop={handleEngineStop}
        cooldownTicks={100}
      />
      {graphData.nodes.length > 0 && graphDataMemo.nodes.length === 0 ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          当前筛选条件下无可视节点
        </div>
      ) : null}
      {graphDataMemo.nodes.length > 0 && !isGraphReady ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          正在加载画布...
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="absolute z-20 w-44 rounded-lg border border-border bg-card/95 p-2 text-xs shadow-sm backdrop-blur-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
            {contextMenu.node.name}
          </div>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1 text-left text-foreground transition hover:bg-muted"
            onClick={handleEditEntity}
            disabled={isMutating}
          >
            编辑实体
          </button>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1 text-left text-foreground transition hover:bg-muted"
            onClick={() => setMergeOpen((prev) => !prev)}
            disabled={isMutating}
          >
            合并实体
          </button>
          {mergeOpen ? (
            <div className="mt-2 space-y-2 rounded-md border border-border/50 bg-background p-2">
              <input
                value={mergeQuery}
                onChange={(event) => setMergeQuery(event.target.value)}
                placeholder="搜索目标实体"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {mergeOptions.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`w-full rounded-md px-2 py-1 text-left text-[11px] transition ${
                      mergeTargetId === node.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                    onClick={() => setMergeTargetId(node.id)}
                  >
                    <div className="font-medium">{node.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {node.type ?? "unknown"}
                      {node.description
                        ? ` · ${node.description.slice(0, 14)}${node.description.length > 14 ? "..." : ""}`
                        : ""}
                    </div>
                  </button>
                ))}
                {mergeOptions.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">无匹配实体</div>
                ) : null}
              </div>
              <button
                type="button"
                className="w-full rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
                onClick={handleMergeEntity}
                disabled={isMutating}
              >
                确认合并
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="w-full rounded-md px-2 py-1 text-left text-destructive transition hover:bg-muted"
            onClick={handleDeleteEntity}
            disabled={isMutating}
          >
            删除实体
          </button>
        </div>
      ) : null}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增角色</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="entity-name">
                角色名称
              </label>
              <Input
                id="entity-name"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="例如：林澄"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="entity-description">
                角色描述
              </label>
              <Textarea
                id="entity-description"
                rows={3}
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="简单描述角色背景或特征"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="entity-type">
                角色类型
              </label>
              <select
                id="entity-type"
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={createForm.type}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    type: event.target.value as EntityType,
                  }))
                }
              >
                {Object.keys(ENTITY_TYPE_LABELS).map((type) => (
                  <option key={type} value={type}>
                    {ENTITY_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="entity-aliases">
                角色别名
              </label>
              <Input
                id="entity-aliases"
                value={createForm.aliases}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    aliases: event.target.value,
                  }))
                }
                placeholder="使用英文逗号分隔，例如：阿澄, 林小姐"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">角色属性</label>
              <div className="space-y-2">
                {propertyRows.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="属性名 (如: age)"
                      value={row.key}
                      onChange={(e) =>
                        handlePropertyChange(index, "key", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder="属性值 (如: 28)"
                      value={row.value}
                      onChange={(e) =>
                        handlePropertyChange(index, "value", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => handleRemovePropertyRow(index)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={handleAddPropertyRow}
                >
                  + 添加属性
                </Button>
              </div>
            </div>
            {createError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {createError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateEntity} disabled={isMutating}>
              {isMutating ? "创建中..." : "确认创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editRelationOpen} onOpenChange={setEditRelationOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑关系</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-sm font-medium">关系名称</label>
              <Input
                value={editRelationForm.relation_name}
                onChange={(e) =>
                  setEditRelationForm((prev) => ({
                    ...prev,
                    relation_name: e.target.value,
                  }))
                }
                placeholder="例如：师徒"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">关系类型</label>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editRelationForm.relation_type}
                onChange={(e) =>
                  setEditRelationForm((prev) => ({
                    ...prev,
                    relation_type: e.target.value,
                  }))
                }
              >
                {Object.keys(RELATION_COLOR_INDEX).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">描述</label>
              <Textarea
                rows={3}
                value={editRelationForm.description}
                onChange={(e) =>
                  setEditRelationForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="关系的详细描述"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRelationOpen(false)}>
              取消
            </Button>
            <Button onClick={handleUpdateRelation} disabled={isMutating}>
              {isMutating ? "更新中..." : "确认更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="absolute left-4 top-4 z-10 w-[280px] space-y-3 rounded-lg border border-border bg-card/95 p-3 text-xs shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-muted-foreground">角色关系</div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setCreateError(null)
              setCreateForm({
                name: "",
                description: "",
                type: "character",
                aliases: "",
                properties: "",
              })
              setCreateOpen(true)
            }}
          >
            新增角色
          </Button>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground">搜索实体</div>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="输入名称或别名"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground">实体类型筛选</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {Object.keys(filterTypes).map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-[11px] text-muted-foreground transition hover:border-border/50 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={filterTypes[type]}
                  className="accent-primary"
                  onChange={(event) =>
                    setFilterTypes((prev) => ({
                      ...prev,
                      [type]: event.target.checked,
                    }))
                  }
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      palette.entity[type] ?? palette.entity.unknown,
                  }}
                />
                {ENTITY_TYPE_LABELS[type] ?? type}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground">关系类型筛选</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {relationTypes.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-[11px] text-muted-foreground transition hover:border-border/50 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={filterRelations[type] ?? true}
                  className="accent-primary"
                  onChange={(event) =>
                    setFilterRelations((prev) => ({
                      ...prev,
                      [type]: event.target.checked,
                    }))
                  }
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: getRelationColor(type, palette) }}
                />
                {type}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground">路径查找</div>
          <div className="mt-1 flex flex-col gap-1">
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
              onClick={handlePathFind}
            >
              查找路径
            </button>
          </div>
          {pathRelations.length > 0 ? (
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
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
        <div className="absolute right-4 top-4 z-10 w-[280px] rounded-lg border border-border bg-card/95 p-3 text-xs shadow-sm backdrop-blur-sm">
          <div className="text-sm font-semibold text-foreground">
            {selectedEntity.name}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            类型：{ENTITY_TYPE_LABELS[normalizeEntityType(selectedEntity.type)]}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {selectedEntity.description || "暂无描述"}
          </div>
          {selectedEntity.properties ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              属性：{JSON.stringify(selectedEntity.properties)}
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-muted-foreground">
            相关节点：{selectedEntity.source_refs?.length ?? 0}
          </div>
        </div>
      ) : null}
      {selectedRelation ? (
        <div className="absolute right-4 bottom-4 z-10 w-[280px] rounded-lg border border-border bg-card/95 p-3 text-xs shadow-sm backdrop-blur-sm">
          <div className="text-sm font-semibold text-foreground">
            {selectedRelation.relation_name ?? "关系"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            类型：{selectedRelation.relation_type ?? "related_to"}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {selectedRelation.description || "暂无描述"}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            关联：
            {typeof selectedRelation.source === "string"
              ? selectedRelation.source
              : selectedRelation.source?.name ?? selectedRelation.source?.id ?? "?"}{" "}
            →{" "}
            {typeof selectedRelation.target === "string"
              ? selectedRelation.target
              : selectedRelation.target?.name ?? selectedRelation.target?.id ?? "?"}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-6 flex-1 text-[10px]"
              onClick={handleEditRelation}
              disabled={isMutating || !selectedRelation.id}
            >
              编辑
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 flex-1 text-[10px]"
              onClick={handleDeleteRelation}
              disabled={isMutating || !selectedRelation.id}
            >
              删除
            </Button>
          </div>
        </div>
      ) : null}
      {toasts.length > 0 ? (
        <div className="absolute right-4 top-4 z-20 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-md border px-3 py-2 text-xs shadow-sm ${
                toast.type === "success"
                  ? "border-border bg-primary/10 text-primary"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
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
