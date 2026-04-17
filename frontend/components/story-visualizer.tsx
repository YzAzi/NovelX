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
import { Search, Upload, Plus, FileText, Map as MapIcon, ZoomIn, ZoomOut, PanelLeftOpen } from "lucide-react"

import type { StoryNode, StoryProject } from "@/src/types/models"
import { createImportOutlineTask, insertNode, reorderNodes, waitForAsyncTask } from "@/src/lib/api"
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

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

const defaultEdgeOptions = {
  type: "smoothstep",
  animated: false,
  style: {
    stroke: "oklch(0.55 0.02 84)",
    strokeWidth: 2,
    strokeDasharray: "6 3",
  },
}

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
        "group w-[220px] overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card to-card/95 p-0 shadow-sm transition-all duration-300",
        selected
          ? "border-primary/60 shadow-lg shadow-primary/10 ring-2 ring-primary/20"
          : data.highlight
            ? "border-amber-400/60 shadow-md shadow-amber-500/10 ring-2 ring-amber-400/30"
            : "border-border/80 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!bg-muted-foreground/40 !h-3.5 !w-1 !rounded-full !border-none" />

      <div className={cn(
        "h-1.5 w-full transition-colors",
        selected
          ? "bg-gradient-to-r from-primary/80 to-primary/40"
          : data.highlight
            ? "bg-gradient-to-r from-amber-400/80 to-amber-400/30"
            : "bg-gradient-to-r from-primary/20 to-transparent opacity-0 group-hover:opacity-100",
      )} />

      <div className="px-3.5 pt-3 pb-3">
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="text-[13px] font-semibold leading-tight text-card-foreground line-clamp-2 tracking-tight">
            {data.title}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium backdrop-blur-sm",
            data.colorClass,
          )}>
            <MapIcon size={9} />
            {data.locationTag}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} isConnectable={false} className="!bg-muted-foreground/40 !h-3.5 !w-1 !rounded-full !border-none" />
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
      style: {
        stroke: "oklch(0.62 0.02 76 / 0.5)",
        strokeWidth: 2,
        strokeDasharray: "6 3",
      },
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
  const storyNodes = useMemo(() => currentProject?.nodes ?? [], [currentProject?.nodes])
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
  const [mobileSceneSheetOpen, setMobileSceneSheetOpen] = useState(false)
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
      hint = "请先在设置中补充可用的访问密钥。"
    } else if (message.includes("自定义 Prompt")) {
      hint = "请检查自定义创作指令是否包含必需变量：raw_text、output_schema。"
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
      const created = await createImportOutlineTask(currentProject.id, content)
      const completedTask = await waitForAsyncTask<StoryProject>(created.task.id)
      if (completedTask.status === "failed") {
        throw new Error(completedTask.error_message || "导入失败")
      }
      const updated = completedTask.result_payload
      if (!updated) {
        throw new Error("导入任务已完成，但未返回项目结果。")
      }
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
      setMobileSceneSheetOpen(false)
      setNodeEditorOpen(true)
    },
    [selectNode, setNodeEditorOpen]
  )

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id)
      setMobileSceneSheetOpen(false)
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
  const activeSceneLabel =
    orderedStoryNodes.find((node) => node.id === activeSceneId)?.title?.trim() || "未选择场景"

  const sceneSidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="text-sm font-semibold tracking-tight text-foreground">场景目录</div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:bg-primary/5 hover:text-foreground"
            onClick={() => setImportOpen(true)}
            title="导入大纲"
          >
            <Upload size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:bg-primary/5 hover:text-foreground"
            onClick={() => setCreateOpen(true)}
            title="新增场景"
          >
            <Plus size={13} />
          </Button>
        </div>
      </div>

      {!hasNodes ? (
        <div className="m-3 rounded-xl border border-dashed border-border/60 bg-background/60 p-3.5 text-xs text-muted-foreground">
          <div className="mb-0.5 font-medium text-foreground">还没有场景节点</div>
          <div className="mb-3">先新增一个场景，或导入已有大纲。</div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="rounded-lg text-xs" onClick={() => setCreateOpen(true)}>
              新增场景
            </Button>
            <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={() => setImportOpen(true)}>
              导入大纲
            </Button>
          </div>
        </div>
      ) : null}

      <div className="px-3 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            className="h-8 w-full rounded-lg border-transparent bg-muted/40 pl-8 text-xs shadow-none focus-visible:border-primary/20 focus-visible:ring-1 focus-visible:ring-primary/15"
            placeholder="搜索场景或地点..."
            value={sceneSearch}
            onChange={(event) => setSceneSearch(event.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 px-2.5 pb-2.5">
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
                    "group flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-xs transition-all duration-200",
                    isActive
                      ? "bg-primary/8 text-foreground shadow-sm ring-1 ring-primary/10"
                      : "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
                  )}
                  onClick={() => {
                    focusScene(node.id)
                    setMobileSceneSheetOpen(false)
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1 w-1 rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-muted-foreground/30 group-hover:bg-primary/50",
                      )}
                    />
                    <span className={cn("line-clamp-1 text-[12px] font-medium leading-tight", isActive ? "text-primary" : "text-foreground/90")}>
                      {node.title || "未命名节点"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 pl-2.5">
                    <MapIcon size={9} className={cn("transition-colors", isActive ? "text-primary/60" : "text-muted-foreground/50")} />
                    <span className="text-[10px] text-muted-foreground/80">{getLocationTag(node)}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>
    </>
  )

  return (
    <div ref={wrapperRef} className="flex h-full flex-col overflow-hidden bg-background lg:flex-row">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border/60 bg-background/60 backdrop-blur-sm lg:flex">
        {sceneSidebarContent}
      </aside>

      <div className="flex items-center gap-2 border-b border-border/60 bg-background/80 px-3 py-2.5 backdrop-blur-sm lg:hidden">
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => setMobileSceneSheetOpen(true)}
        >
          <PanelLeftOpen className="h-4 w-4" />
          场景
        </Button>
        <div className="min-w-0 flex-1 rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          <span className="mr-1 inline-block text-foreground/80">当前:</span>
          <span className="line-clamp-1">{activeSceneLabel}</span>
        </div>
        <Button variant="ghost" size="icon-sm" className="rounded-xl" onClick={() => setImportOpen(true)} title="导入大纲">
          <Upload className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="rounded-xl" onClick={() => setCreateOpen(true)} title="新增场景">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative min-h-[58vh] flex-1 bg-background lg:min-h-0">
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              <Background gap={28} size={1} color="currentColor" className="text-border/35 subtle-grid" />
              <Controls position="bottom-right" className="!bg-card/80 !backdrop-blur !border !border-border/60 !rounded-xl !shadow-md [&>button]:!border-border/40 [&>button:hover]:!bg-primary/10 [&>button]:!text-foreground" />
              <MiniMap
                pannable
                zoomable
                className="hidden !bg-card/80 !backdrop-blur !border !border-border/60 !rounded-xl !shadow-md md:block"
                nodeColor={(n) => {
                  if (n.selected) return "#5570aa"
                  return "oklch(0.7 0.02 84)"
                }}
                maskColor="hsl(var(--background) / 0.55)"
              />
            </ReactFlow>

            <div className="absolute right-4 top-4 flex items-center gap-1 rounded-xl border border-border/60 bg-card/80 backdrop-blur p-1 shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-primary/5"
                onClick={() => applyZoom(zoomLevel - ZOOM_STEP)}
              >
                <ZoomOut size={13} />
              </Button>
              <div className="w-11 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
                {Math.round(zoomLevel * 100)}%
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-primary/5"
                onClick={() => applyZoom(zoomLevel + ZOOM_STEP)}
              >
                <ZoomIn size={13} />
              </Button>
            </div>

            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/88 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm lg:hidden">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{activeSceneLabel}</div>
                <div>
                  {Math.round(zoomLevel * 100)}% 缩放
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => setMobileSceneSheetOpen(true)}
              >
                <FileText className="h-4 w-4" />
                列表
              </Button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center subtle-grid">
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 backdrop-blur-sm px-8 py-10 text-center shadow-[0_12px_40px_rgba(55,44,28,0.05)]">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto">
                <FileText size={24} />
              </div>
              <div className="text-lg font-semibold text-foreground">开始构建你的故事</div>
              <div className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
                先新增一个场景节点，或导入已有大纲文本。
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Button onClick={() => setCreateOpen(true)} className="rounded-xl">
                  <Plus size={14} />
                  新增场景
                </Button>
                <Button variant="outline" onClick={() => setImportOpen(true)} className="rounded-xl">
                  <Upload size={14} />
                  导入大纲
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Sheet open={mobileSceneSheetOpen} onOpenChange={setMobileSceneSheetOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-none p-0 sm:max-w-sm lg:hidden">
          <SheetHeader className="border-b border-border/60">
            <SheetTitle>场景目录</SheetTitle>
            <SheetDescription>切换场景、搜索地点，或快速新增节点。</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sceneSidebarContent}</div>
        </SheetContent>
      </Sheet>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[88vh] w-[95vw] overflow-y-auto sm:max-w-lg">
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
        <DialogContent className="max-h-[88vh] w-[95vw] overflow-y-auto sm:max-w-lg">
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
