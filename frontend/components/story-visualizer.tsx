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

import type { StoryNode } from "@/src/types/models"
import { insertNode, reorderNodes } from "@/src/lib/api"
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

const NODE_WIDTH = 220
const NODE_HEIGHT = 120
const LANE_HEIGHT = 180
const ZOOM_MIN = 0.4
const ZOOM_MAX = 1.4
const ZOOM_STEP = 0.1
const TAG_COLORS = [
  "bg-amber-100/80 text-amber-900",
  "bg-sky-100/80 text-sky-900",
  "bg-emerald-100/80 text-emerald-900",
  "bg-rose-100/80 text-rose-900",
  "bg-lime-100/80 text-lime-900",
  "bg-orange-100/80 text-orange-900",
  "bg-teal-100/80 text-teal-900",
  "bg-fuchsia-100/80 text-fuchsia-900",
]

const defaultEdgeOptions = { type: "smoothstep", animated: false }

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
        "w-[220px] rounded-xl border border-border/60 bg-card/90 p-3 shadow-sm backdrop-blur-md transition hover:shadow-md hover:-translate-y-0.5",
        selected
          ? "ring-2 ring-primary/60 border-primary/30"
          : data.highlight
            ? "ring-2 ring-amber-300"
            : "hover:border-primary/30"
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="mb-2 text-sm font-semibold text-slate-900">{data.title}</div>
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", data.colorClass)}>
        {data.locationTag}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
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
      <div className="surface-card flex h-full items-center justify-center border-dashed text-sm text-muted-foreground">
        先创建大纲以查看节点布局。
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="surface-card flex h-full overflow-hidden">
      <div className="flex w-[240px] shrink-0 flex-col border-r border-border/40 bg-white/40 backdrop-blur-sm">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <div className="text-xs font-semibold text-slate-500">场景目录</div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setCreateOpen(true)}
          >
            新增节点
          </Button>
        </div>
        <div className="px-3 pb-2">
          <input
            className="h-8 w-full rounded-md border border-slate-200/80 bg-white/80 px-2 text-xs text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="搜索场景或地点..."
            value={sceneSearch}
            onChange={(event) => setSceneSearch(event.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          {filteredStoryNodes.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">暂无匹配场景</div>
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
                    "flex w-full flex-col gap-1 px-3 py-2 text-left text-xs transition",
                    isActive
                      ? "bg-white/80 text-slate-900 shadow-sm"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                  )}
                  onClick={() => focusScene(node.id)}
                  type="button"
                >
                  <span className="font-semibold">{node.title || "未命名节点"}</span>
                  <span className="text-[11px] text-slate-500">{getLocationTag(node)}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
      <div className="relative flex-1">
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
        >
          <Background gap={24} size={1} />
          <Controls position="bottom-right" />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <div className="glass-panel absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-2 text-xs text-slate-700 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => applyZoom(zoomLevel - ZOOM_STEP)}
          >
            −
          </Button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoomLevel}
            onChange={(event) => applyZoom(Number(event.target.value))}
            className="h-2 w-28 accent-sky-500"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => applyZoom(zoomLevel + ZOOM_STEP)}
          >
            +
          </Button>
          <div className="w-12 text-right text-[11px] text-slate-500">
            {Math.round(zoomLevel * 100)}%
          </div>
        </div>
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增节点</DialogTitle>
            <DialogDescription>填写叙事顺序与时间轴位置，系统会自动后移对应顺序。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new-node-title">
                标题
              </label>
              <Input
                id="new-node-title"
                value={createForm.title}
                onChange={handleCreateFieldChange("title")}
                placeholder="例如：新的转折"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new-node-content">
                内容梗概
              </label>
              <Textarea
                id="new-node-content"
                rows={4}
                value={createForm.content}
                onChange={handleCreateFieldChange("content")}
                placeholder="简单描述该节点的剧情"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="new-node-order">
                  叙事顺序
                </label>
                <Input
                  id="new-node-order"
                  type="number"
                  value={createForm.narrativeOrder}
                  onChange={handleCreateFieldChange("narrativeOrder")}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="new-node-timeline">
                  时间轴位置
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
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new-node-location">
                泳道标签
              </label>
              <Input
                id="new-node-location"
                value={createForm.locationTag}
                onChange={handleCreateFieldChange("locationTag")}
                placeholder="例如：港口、旧城区"
              />
            </div>
            {createError ? (
              <div className="rounded-lg border border-red-200/70 bg-red-50/70 px-3 py-2 text-xs text-red-700">
                {createError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateNode} disabled={isCreating}>
              {isCreating ? "新增中..." : "确认新增"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
