"use client"

import "@xyflow/react/dist/style.css"

import { useMemo, useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import dagre from "dagre"
import { Search, Upload, Plus, Minus, FileText, Image, Map as MapIcon, ZoomIn, ZoomOut } from "lucide-react"

import type { StoryNode } from "@/src/types/models"
import { importOutline, insertNode, reorderNodes } from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"

const NODE_WIDTH = 220
const NODE_HEIGHT = 120
const LANE_HEIGHT = 180
const ZOOM_MIN = 0.4
const ZOOM_MAX = 1.4
const ZOOM_STEP = 0.1
const TAG_COLORS = [
  "bg-amber-100/80 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-sky-100/80 text-sky-900 dark:bg-sky-900/30 dark:text-sky-300",
  "bg-emerald-100/80 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-rose-100/80 text-rose-900 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-lime-100/80 text-lime-900 dark:bg-lime-900/30 dark:text-lime-300",
  "bg-orange-100/80 text-orange-900 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-teal-100/80 text-teal-900 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-fuchsia-100/80 text-fuchsia-900 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
]

const defaultEdgeOptions = { type: "smoothstep", animated: false, style: { stroke: "var(--border)", strokeWidth: 2 } }

type StoryNodeData = {
  title: string
  locationTag: string
  colorClass: string
  highlight: boolean
}

type StoryFlowNode = Node<StoryNodeData, "storyNode">
type FlowApi = {
  zoomTo?: (zoom: number, options?: { duration?: number }) => void
  setViewport?: (
    viewport: { x: number; y: number; zoom: number },
    options?: { duration?: number }
  ) => void
  getViewport?: () => { x: number; y: number; zoom: number }
}

function StoryNodeCard({ data, selected }: NodeProps<StoryFlowNode>) {
  return (
    <div
      className={cn(
        "w-[220px] rounded-xl border bg-card p-4 shadow-sm transition-all duration-200",
        selected
          ? "border-primary ring-1 ring-primary shadow-md"
          : data.highlight
            ? "border-amber-400 ring-1 ring-amber-400"
            : "border-border hover:border-primary/50 hover:shadow-md"
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!bg-muted-foreground/50 !h-3 !w-1 !rounded-sm !border-none" />
      <div className="mb-3 text-sm font-semibold text-card-foreground leading-tight">{data.title}</div>
      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium", data.colorClass)}>
        <MapIcon size={10} />
        {data.locationTag}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!bg-muted-foreground/50 !h-3 !w-1 !rounded-sm !border-none" />
    </div>
  )
}

function getLocationTag(node: StoryNode) {
  const tag = node.location_tag?.trim()
  return tag && tag.length > 0 ? tag : "未标记"
}

function getTagColor(tag: string, lanes: string[]) {
  const index = lanes.indexOf(tag)
  return TAG_COLORS[index % TAG_COLORS.length]
}

function buildEdges(nodes: StoryNode[]): Edge[] {
  const sorted = [...nodes].sort((a, b) => a.narrative_order - b.narrative_order)
  const edges: Edge[] = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const source = sorted[i]
    const target = sorted[i + 1]
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      type: "smoothstep",
      style: { stroke: "var(--muted-foreground)", strokeWidth: 2, opacity: 0.6 },
    })
  }
  return edges
}

function buildLayoutEdges(nodes: StoryNode[]) {
  const sorted = [...nodes].sort((a, b) => a.timeline_order - b.timeline_order)
  const edges: Array<{ source: string; target: string }> = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    edges.push({ source: sorted[i].id, target: sorted[i + 1].id })
  }
  return edges
}

function buildLayout(
  storyNodes: StoryNode[],
  lanes: string[]
): { nodes: StoryFlowNode[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 140,
  })

  storyNodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  const layoutEdges = buildLayoutEdges(storyNodes)
  layoutEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const laneMap = new Map<string, number>()
  lanes.forEach((tag, index) => laneMap.set(tag, index))

  const nodes: StoryFlowNode[] = storyNodes.map((node) => {
    const tag = getLocationTag(node)
    const laneIndex = laneMap.get(tag) ?? 0
    const dagreNode = dagreGraph.node(node.id)
    const x = dagreNode ? dagreNode.x - NODE_WIDTH / 2 : 0
    const y = laneIndex * LANE_HEIGHT + (LANE_HEIGHT - NODE_HEIGHT) / 2

    return {
      id: node.id,
      type: "storyNode",
      data: {
        title: node.title || "未命名节点",
        locationTag: tag,
        colorClass: getTagColor(tag, lanes),
        highlight: false,
      },
      position: { x, y },
    }
  })

  return { nodes, edges: buildEdges(storyNodes) }
}

export function StoryVisualizer() {
  const {
    currentProject,
    selectedNodeId,
    highlightedNodeIds,
    selectNode,
    setProject,
    setNodeEditorOpen,
  } = useProjectStore()
  const storyNodes = currentProject?.nodes ?? []
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const sceneItemRefs = useRef(new Map<string, HTMLButtonElement>())
  const moveFrameRef = useRef<number | null>(null)
  const activeSceneRef = useRef<string | null>(null)
  const [sceneSearch, setSceneSearch] = useState("")
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importText, setImportText] = useState("")
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [createForm, setCreateForm] = useState({
    title: "",
    content: "",
    narrativeOrder: "",
    timelineOrder: "",
    locationTag: "",
  })
  const lanes = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    storyNodes.forEach((node) => {
      const tag = getLocationTag(node)
      if (!seen.has(tag)) {
        seen.add(tag)
        result.push(tag)
      }
    })
    return result.length > 0 ? result : ["未标记"]
  }, [storyNodes])
  const nextNarrativeOrder = useMemo(() => {
    if (storyNodes.length === 0) {
      return 1
    }
    return Math.max(...storyNodes.map((node) => node.narrative_order ?? 0)) + 1
  }, [storyNodes])
  const nextTimelineOrder = useMemo(() => {
    if (storyNodes.length === 0) {
      return 1
    }
    return Math.max(...storyNodes.map((node) => node.timeline_order ?? 0)) + 1
  }, [storyNodes])

  const { nodes, edges } = useMemo(() => buildLayout(storyNodes, lanes), [storyNodes, lanes])

  const orderedStoryNodes = useMemo(
    () => [...storyNodes].sort((a, b) => a.narrative_order - b.narrative_order),
    [storyNodes]
  )

  const filteredStoryNodes = useMemo(() => {
    const keyword = sceneSearch.trim().toLowerCase()
    if (!keyword) {
      return orderedStoryNodes
    }
    return orderedStoryNodes.filter((node) => {
      const title = node.title?.toLowerCase() ?? ""
      const tag = getLocationTag(node).toLowerCase()
      return title.includes(keyword) || tag.includes(keyword)
    })
  }, [orderedStoryNodes, sceneSearch])

  const nodeById = useMemo(() => {
    const map = new Map<string, StoryFlowNode>()
    nodes.forEach((node) => {
      map.set(node.id, node)
    })
    return map
  }, [nodes])

  const flowNodes = useMemo(() => {
    const highlighted = new Set(highlightedNodeIds)
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        highlight: highlighted.has(node.id),
      },
    }))
  }, [nodes, highlightedNodeIds, selectedNodeId])

  useEffect(() => {
    activeSceneRef.current = activeSceneId
  }, [activeSceneId])

  useEffect(() => {
    if (!activeSceneId && orderedStoryNodes.length > 0) {
      setActiveSceneId(orderedStoryNodes[0].id)
    }
  }, [activeSceneId, orderedStoryNodes])

  useEffect(() => {
    if (selectedNodeId) {
      setActiveSceneId(selectedNodeId)
    }
  }, [selectedNodeId])

  useEffect(() => {
    if (!createOpen) {
      setCreateError(null)
      return
    }
    const orderValue = String(nextNarrativeOrder)
    const timelineValue = String(nextTimelineOrder)
    setCreateForm({
      title: "",
      content: "",
      narrativeOrder: orderValue,
      timelineOrder: timelineValue,
      locationTag: "",
    })
  }, [createOpen, nextNarrativeOrder, nextTimelineOrder])

  useEffect(() => {
    if (!importOpen) {
      setImportError(null)
      setImportText("")
      setImportFileName(null)
    }
  }, [importOpen])

  const handleCreateFieldChange =
    (field: keyof typeof createForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCreateForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleCreateNode = useCallback(async () => {
    if (!currentProject) {
      return
    }
    const narrativeValue = Number.parseInt(createForm.narrativeOrder, 10)
    if (!Number.isFinite(narrativeValue) || narrativeValue < 1) {
      setCreateError("叙事顺序必须是大于等于 1 的整数")
      return
    }
    const timelineValue = createForm.timelineOrder.trim()
      ? Number.parseFloat(createForm.timelineOrder)
      : narrativeValue
    if (!Number.isFinite(timelineValue) || timelineValue <= 0) {
      setCreateError("时间轴位置必须是大于 0 的数字")
      return
    }

    const newId = `node-${crypto.randomUUID()}`
    const payload = {
      project_id: currentProject.id,
      node: {
        id: newId,
        title: createForm.title.trim() || "未命名节点",
        content: createForm.content,
        narrative_order: narrativeValue,
        timeline_order: timelineValue,
        location_tag: createForm.locationTag.trim() || "未标记",
        characters: [],
      },
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      const response = await insertNode(payload)
      setProject(response.project)
      setCreateOpen(false)
      selectNode(newId)
      setNodeEditorOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : "新增节点失败"
      setCreateError(message)
    } finally {
      setIsCreating(false)
    }
  }, [createForm, currentProject, selectNode, setNodeEditorOpen, setProject])

  const formatImportError = useCallback((rawMessage: string) => {
    const message = rawMessage || "导入失败"
    let hint = ""

    if (message.includes("OPENAI_API_KEY")) {
      hint = "请先在模型设置或 .env 中配置 API Key。"
    } else if (message.includes("自定义 Prompt")) {
      hint = "请检查 Prompt 是否包含必需变量：raw_text、output_schema。"
    } else if (message.includes("Outline content cannot be empty")) {
      hint = "请粘贴大纲文本或上传 .txt/.md 文件。"
    } else if (message.includes("Project not found")) {
      hint = "项目可能已被删除，请刷新后重试。"
    } else if (message.includes("Request failed")) {
      hint = "后端请求失败，请检查服务是否运行。"
    }

    return hint ? `${message}\n建议：${hint}` : message
  }, [])

  const handleImportOutline = useCallback(async () => {
    if (!currentProject) {
      return
    }
    const content = importText.trim()
    if (!content) {
      setImportError("请输入或上传大纲文本")
      return
    }
    setIsImporting(true)
    setImportError(null)
    try {
      const updated = await importOutline(currentProject.id, content)
      setProject(updated)
      selectNode(null)
      const next = [...updated.nodes].sort((a, b) => a.narrative_order - b.narrative_order)[0]
      setActiveSceneId(next?.id ?? null)
      setImportOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败"
      setImportError(formatImportError(message))
    } finally {
      setIsImporting(false)
    }
  }, [currentProject, formatImportError, importText, selectNode, setProject])

  const handleImportFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
        setImportError("仅支持 .txt / .md 文件")
        return
      }
      try {
        const text = await file.text()
        setImportText(text)
        setImportFileName(file.name)
        setImportError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取文件失败"
        setImportError(message)
      }
    },
    []
  )

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id)
      setNodeEditorOpen(true)
    },
    [selectNode, setNodeEditorOpen]
  )

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id)
      document.getElementById("node-editor")?.focus()
    },
    [selectNode]
  )

  const nodeTypes = useMemo(() => ({ storyNode: StoryNodeCard }), [])

  const focusScene = useCallback(
    (id: string) => {
      const instance = flowInstanceRef.current
      const node = nodeById.get(id)
      if (!instance || !node) {
        return
      }
      const viewport = instance.getViewport()
      instance.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
        zoom: viewport.zoom,
        duration: 250,
      })
      setActiveSceneId(id)
    },
    [nodeById]
  )

  const updateActiveSceneFromViewport = useCallback(() => {
    const instance = flowInstanceRef.current
    const wrapper = wrapperRef.current
    if (!instance || !wrapper || flowNodes.length === 0) {
      return
    }
    const viewport = instance.getViewport()
    setZoomLevel(viewport.zoom)
    const rect = wrapper.getBoundingClientRect()
    const centerX = -viewport.x / viewport.zoom + rect.width / 2 / viewport.zoom
    const centerY = -viewport.y / viewport.zoom + rect.height / 2 / viewport.zoom
    let closestId: string | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    flowNodes.forEach((node) => {
      const nodeCenterX = node.position.x + NODE_WIDTH / 2
      const nodeCenterY = node.position.y + NODE_HEIGHT / 2
      const distance = (nodeCenterX - centerX) ** 2 + (nodeCenterY - centerY) ** 2
      if (distance < closestDistance) {
        closestDistance = distance
        closestId = node.id
      }
    })
    if (closestId && closestId !== activeSceneRef.current) {
      setActiveSceneId(closestId)
    }
  }, [flowNodes])

  const handleMove = useCallback(() => {
    if (moveFrameRef.current) {
      return
    }
    moveFrameRef.current = window.requestAnimationFrame(() => {
      moveFrameRef.current = null
      updateActiveSceneFromViewport()
    })
  }, [updateActiveSceneFromViewport])

  const applyZoom = useCallback((nextZoom: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom))
    const instance = flowInstanceRef.current as unknown as FlowApi | null
    if (instance?.zoomTo) {
      instance.zoomTo(clamped, { duration: 150 })
    } else if (instance?.setViewport && instance?.getViewport) {
      const viewport = instance.getViewport()
      instance.setViewport({ ...viewport, zoom: clamped }, { duration: 150 })
    }
    setZoomLevel(clamped)
  }, [])

  useEffect(() => {
    const instance = flowInstanceRef.current
    if (!instance || flowNodes.length === 0) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      instance.fitView({ padding: 0.2, duration: 0 })
    })
    return () => window.cancelAnimationFrame(id)
  }, [flowNodes.length])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) {
      return
    }

    const observer = new ResizeObserver(() => {
      const instance = flowInstanceRef.current
      if (!instance || flowNodes.length === 0) {
        return
      }
      window.requestAnimationFrame(() => {
        instance.fitView({ padding: 0.2, duration: 0 })
      })
    })

    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [flowNodes.length])

  useEffect(() => {
    if (!activeSceneId) {
      return
    }
    const nodeEl = sceneItemRefs.current.get(activeSceneId)
    if (!nodeEl) {
      return
    }
    nodeEl.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [activeSceneId, filteredStoryNodes])

  const handleNodeDragStop = useCallback(async () => {
    if (!currentProject || !flowInstanceRef.current) {
      return
    }

    const currentFlowNodes = flowInstanceRef.current.getNodes()
    const sortedFlowNodes = [...currentFlowNodes].sort((a, b) => a.position.x - b.position.x)
    const sortedIds = sortedFlowNodes.map((n) => n.id)

    // Check if order actually changed to avoid unnecessary API calls
    const currentOrderIds = [...currentProject.nodes]
      .sort((a, b) => a.narrative_order - b.narrative_order)
      .map((n) => n.id)
    
    const hasChanged = sortedIds.some((id, index) => id !== currentOrderIds[index])
    if (!hasChanged) {
      return
    }

    try {
      const updatedProject = await reorderNodes(currentProject.id, sortedIds)
      setProject(updatedProject)
    } catch (error) {
      console.error("Failed to reorder nodes:", error)
    }
  }, [currentProject, setProject])

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center border-dashed border-2 border-muted rounded-xl bg-muted/20 text-sm text-muted-foreground m-4">
        先创建大纲以查看节点布局。
      </div>
    )
  }

  const hasNodes = storyNodes.length > 0

  return (
    <div ref={wrapperRef} className="flex h-full overflow-hidden bg-background">
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border bg-muted/10">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="text-sm font-semibold text-foreground">场景目录</div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setImportOpen(true)}
              title="导入大纲"
            >
              <Upload size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setCreateOpen(true)}
              title="新增场景"
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>

        {!hasNodes ? (
          <div className="m-3 rounded-lg border border-dashed border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">还没有场景节点</div>
            <div className="mt-1">先新增一个场景，或导入已有大纲。</div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                新增场景
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                导入大纲
              </Button>
            </div>
          </div>
        ) : null}

        <div className="p-3">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                    className="h-9 w-full bg-background pl-8 text-xs shadow-none border-border/60 focus-visible:ring-1 focus-visible:ring-primary/20"
                    placeholder="搜索场景或地点..."
                    value={sceneSearch}
                    onChange={(event) => setSceneSearch(event.target.value)}
                />
            </div>
        </div>
        
        <ScrollArea className="flex-1">
           <div className="px-3 pb-3 space-y-1">
              {filteredStoryNodes.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无匹配场景</div>
              ) : (
                filteredStoryNodes.map((node) => {
                  const isActive = node.id === activeSceneId
                  return (
                    <button
                      key={node.id}
                      ref={(el) => {
                        if (el) {
                          sceneItemRefs.current.set(node.id, el)
                        } else {
                          sceneItemRefs.current.delete(node.id)
                        }
                      }}
                      className={cn(
                        "group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left text-xs transition-all",
                        isActive
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                      onClick={() => focusScene(node.id)}
                      type="button"
                    >
                      <span className={cn("font-medium line-clamp-1", isActive ? "text-primary" : "text-foreground")}>{node.title || "未命名节点"}</span>
                      <div className="flex items-center gap-1.5 opacity-70">
                         <MapIcon size={10} />
                         <span className="text-[10px]">{getLocationTag(node)}</span>
                      </div>
                    </button>
                  )
                })
              )}
          </div>
        </ScrollArea>
      </div>

      <div className="relative flex-1 bg-background">
        {hasNodes ? (
          <>
            <ReactFlow
              nodes={flowNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              className="h-full w-full"
              defaultEdgeOptions={defaultEdgeOptions}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onNodeDragStop={handleNodeDragStop}
              onMove={handleMove}
              onInit={(instance) => {
                flowInstanceRef.current = instance as any
              }}
              panOnScroll
              zoomOnScroll
              fitView
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              nodesDraggable={true}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} color="currentColor" className="text-border/40" />
              <Controls position="bottom-right" className="!bg-card !border !border-border !rounded-lg !shadow-sm [&>button]:!border-border/40 [&>button:hover]:!bg-muted" />
              <MiniMap 
                pannable 
                zoomable 
                className="!bg-card !border !border-border !rounded-lg !shadow-sm" 
                nodeColor={(n) => {
                     if (n.selected) return 'hsl(var(--primary))';
                     return 'hsl(var(--muted))';
                }}
                maskColor="hsl(var(--background) / 0.7)"
              />
            </ReactFlow>

            <div className="absolute right-4 top-4 flex items-center gap-1 rounded-lg border border-border bg-card/80 backdrop-blur p-1 shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => applyZoom(zoomLevel - ZOOM_STEP)}
              >
                <Minus size={14} />
              </Button>
              <div className="w-12 text-center text-xs font-medium tabular-nums text-muted-foreground">
                {Math.round(zoomLevel * 100)}%
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => applyZoom(zoomLevel + ZOOM_STEP)}
              >
                <Plus size={14} />
              </Button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl border border-dashed border-border/70 bg-background/80 px-6 py-8 text-center text-sm shadow-sm">
              <div className="text-base font-semibold text-foreground">开始构建你的故事</div>
              <div className="mt-2 text-xs text-muted-foreground">
                先新增一个场景节点，或导入已有大纲。
              </div>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button onClick={() => setCreateOpen(true)}>新增场景</Button>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  导入大纲
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增场景节点</DialogTitle>
            <DialogDescription>填写场景的基本信息，它将被插入到当前故事流中。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="new-node-title">
                场景标题
              </label>
              <Input
                id="new-node-title"
                value={createForm.title}
                onChange={handleCreateFieldChange("title")}
                placeholder="例如：深夜的港口会面"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="new-node-content">
                剧情梗概
              </label>
              <Textarea
                id="new-node-content"
                rows={4}
                value={createForm.content}
                onChange={handleCreateFieldChange("content")}
                placeholder="描述发生了什么..."
                className="resize-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="new-node-order">
                  叙事顺序 (Narrative)
                </label>
                <Input
                  id="new-node-order"
                  type="number"
                  value={createForm.narrativeOrder}
                  onChange={handleCreateFieldChange("narrativeOrder")}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="new-node-timeline">
                  时间轴 (Timeline)
                </label>
                <Input
                  id="new-node-timeline"
                  type="number"
                  step="0.1"
                  value={createForm.timelineOrder}
                  onChange={handleCreateFieldChange("timelineOrder")}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="new-node-location">
                地点/分组 (Tag)
              </label>
              <Input
                id="new-node-location"
                value={createForm.locationTag}
                onChange={handleCreateFieldChange("locationTag")}
                placeholder="例如：主角家、警察局"
              />
            </div>
            {createError ? (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                <span className="font-semibold">错误：</span>{createError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateNode} disabled={isCreating}>
              {isCreating ? "创建中..." : "确认创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导入大纲</DialogTitle>
            <DialogDescription>
              粘贴文本或上传 .txt/.md 文件。注意：导入将<b>覆盖</b>当前项目的所有节点。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-dashed border-border p-6 text-center hover:bg-muted/50 transition-colors cursor-pointer relative">
               <input 
                  type="file" 
                  accept=".txt,.md"
                  onChange={handleImportFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
               />
               <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
               <div className="text-sm font-medium">点击上传文件</div>
               <div className="text-xs text-muted-foreground mt-1">支持 TXT, MD</div>
               {importFileName && (
                 <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    <FileText size={12} /> {importFileName}
                 </div>
               )}
            </div>
            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">或者粘贴文本</span>
                </div>
            </div>
            <div className="space-y-2">
              <Textarea
                rows={6}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="第一章：开始..."
                className="font-mono text-xs"
              />
            </div>
            {importError ? (
               <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-line">
                <span className="font-semibold">错误：</span>{importError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button onClick={handleImportOutline} disabled={isImporting}>
              {isImporting ? "导入中..." : "确认导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
