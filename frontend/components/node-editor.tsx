"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import type { StoryNode } from "@/src/types/models";
import { syncNode } from "@/src/lib/api";
import { useProjectStore } from "@/src/stores/project-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function NodeEditor() {
  const {
    addConflict,
    clearConflicts,
    conflicts,
    currentProject,
    nodeEditorOpen,
    selectedNodeId,
    saveStatus,
    setSaveStatus,
    setNodeEditorOpen,
    setSyncNodeId,
    setSyncRequestId,
    setSyncStatus,
    setProject,
    syncStatus,
  } = useProjectStore();
  const [isZenMode, setIsZenMode] = useState(false);
  const selectedNode = useMemo(() => {
    if (!currentProject || !selectedNodeId) {
      return null;
    }
    return (
      currentProject.nodes.find((node) => node.id === selectedNodeId) ?? null
    );
  }, [currentProject, selectedNodeId]);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [narrativeOrder, setNarrativeOrder] = useState("");
  const [timelineOrder, setTimelineOrder] = useState("");
  const [locationTag, setLocationTag] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const [newCharacterNotice, setNewCharacterNotice] = useState<string | null>(
    null,
  );
  const [expandedConflict, setExpandedConflict] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const lastSavedRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveCounterRef = useRef(0);

  useEffect(() => {
    if (!selectedNode) {
      Promise.resolve().then(() => {
        setNodeEditorOpen(false);
        setTitle("");
        setContent("");
        setNarrativeOrder("");
        setTimelineOrder("");
        setLocationTag("");
        setCharacters([]);
        setSaveStatus("idle");
        setNewCharacterNotice(null);
        setValidationError(null);
        clearConflicts();
        setExpandedConflict(null);
        lastSavedRef.current = null;
      });
      return;
    }

    Promise.resolve().then(() => {
      setTitle(selectedNode.title ?? "");
      setContent(selectedNode.content ?? "");
      setNarrativeOrder(String(selectedNode.narrative_order ?? 0));
      setTimelineOrder(String(selectedNode.timeline_order ?? 0));
      setLocationTag(selectedNode.location_tag ?? "");
      setCharacters(selectedNode.characters ?? []);
      setSaveStatus("idle");
      setNewCharacterNotice(null);
      setValidationError(null);
      clearConflicts();
      setExpandedConflict(null);
      lastSavedRef.current = JSON.stringify({
        title: selectedNode.title ?? "",
        content: selectedNode.content ?? "",
        narrativeOrder: String(selectedNode.narrative_order ?? 0),
        timelineOrder: String(selectedNode.timeline_order ?? 0),
        locationTag: selectedNode.location_tag ?? "",
        characters: selectedNode.characters ?? [],
      });
    });
  }, [selectedNodeId, selectedNode, setNodeEditorOpen]);

  const formSnapshot = useMemo(
    () => ({
      title,
      content,
      narrativeOrder,
      timelineOrder,
      locationTag,
      characters,
    }),
    [title, content, narrativeOrder, timelineOrder, locationTag, characters],
  );

  const snapshotKey = useMemo(
    () => JSON.stringify(formSnapshot),
    [formSnapshot],
  );
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setIsDirty(lastSavedRef.current !== snapshotKey);
  }, [snapshotKey]);

  useEffect(() => {
    if (saveStatus === "saving") {
      abortControllerRef.current?.abort();
    }
  }, [snapshotKey, saveStatus]);

  const validateSnapshot = useCallback((snapshot: typeof formSnapshot) => {
    const narrativeValue = Number.parseInt(snapshot.narrativeOrder, 10);
    if (!Number.isFinite(narrativeValue) || narrativeValue < 1) {
      return "叙事顺序必须是大于等于 1 的整数";
    }
    const timelineValue = Number.parseFloat(snapshot.timelineOrder);
    if (!Number.isFinite(timelineValue) || timelineValue <= 0) {
      return "时间轴位置必须是大于 0 的数字";
    }
    return null;
  }, []);

  const buildNodePayload = useCallback(
    (snapshot: typeof formSnapshot): StoryNode | null => {
      if (!selectedNode) {
        return null;
      }

      const narrativeValue = Number.parseInt(snapshot.narrativeOrder, 10);
      const timelineValue = Number.parseFloat(snapshot.timelineOrder);

      return {
        ...selectedNode,
        title: snapshot.title.trim() || "未命名节点",
        content: snapshot.content,
        narrative_order: narrativeValue,
        timeline_order: timelineValue,
        location_tag: snapshot.locationTag.trim() || "未标记",
        characters: snapshot.characters,
      };
    },
    [selectedNode],
  );

  const saveNode = useCallback(
    async (snapshot: typeof formSnapshot) => {
      if (!currentProject || !selectedNode) {
        return;
      }

      const error = validateSnapshot(snapshot);
      if (error) {
        setValidationError(error);
        setSaveStatus("idle");
        setSyncRequestId(null);
        lastSavedRef.current = JSON.stringify(snapshot);
        return;
      }

      const payload = buildNodePayload(snapshot);
      if (!payload) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      saveCounterRef.current += 1;
      const saveId = saveCounterRef.current;
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setSyncRequestId(requestId);
      setSyncNodeId(selectedNode.id);

      setSaveStatus("saving");
      setSyncStatus("syncing");

      try {
        const response = await syncNode(currentProject.id, payload, requestId, {
          signal: controller.signal,
        });
        if (saveCounterRef.current !== saveId) {
          return;
        }

        const nextProject = response.project;
        const previousCharacterIds = new Set(
          currentProject.characters.map((item) => item.id),
        );
        const newCharacters = nextProject.characters.filter(
          (item) => !previousCharacterIds.has(item.id),
        );

        if (newCharacters.length > 0) {
          setNewCharacterNotice(
            `新增角色：${newCharacters.map((item) => item.name).join("、")}`,
          );
        } else {
          setNewCharacterNotice(null);
        }

        setProject(nextProject);
        clearConflicts();
        (response.conflicts ?? []).forEach((conflict) => addConflict(conflict));
        if (response.sync_status === "completed") {
          setSyncStatus("completed");
          setSyncRequestId(null);
        } else if (response.sync_status === "failed") {
          setSyncStatus("failed");
          setSyncRequestId(null);
        }
        setExpandedConflict(null);
        setValidationError(null);
        lastSavedRef.current = JSON.stringify(snapshot);
        setSaveStatus("saved");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSaveStatus("idle");
        setSyncStatus("failed");
        setSyncRequestId(null);
      }
    },
    [
      addConflict,
      buildNodePayload,
      clearConflicts,
      currentProject,
      selectedNode,
      setProject,
      setSaveStatus,
      setSyncRequestId,
      setSyncStatus,
      validateSnapshot,
      setSyncNodeId,
    ],
  );

  const handleManualSave = useCallback(() => {
    if (!selectedNode) {
      return;
    }
    const confirmed = window.confirm("确认保存并更新当前节点吗？");
    if (!confirmed) {
      return;
    }
    saveNode(formSnapshot);
  }, [formSnapshot, saveNode, selectedNode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleManualSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleManualSave]);

  const handleCharacterToggle = (characterId: string) => {
    abortControllerRef.current?.abort();
    setCharacters((prev) =>
      prev.includes(characterId)
        ? prev.filter((id) => id !== characterId)
        : [...prev, characterId],
    );
    setSaveStatus("idle");
    setValidationError(null);
  };

  const handleChange =
    (setter: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      abortControllerRef.current?.abort();
      setter(event.target.value);
      setSaveStatus("idle");
      setValidationError(null);
    };

  if (!selectedNode) {
    return null;
  }

  const characterOptions = currentProject?.characters ?? [];

  return (
    <Dialog open={nodeEditorOpen} onOpenChange={setNodeEditorOpen}>
      <DialogContent
        className={cn(
          "overflow-hidden p-0 transition-all duration-300 ease-in-out",
          isZenMode
            ? "h-screen w-screen max-w-none rounded-none border-0"
            : "max-h-[80vh] max-w-2xl",
        )}
      >
        <Card
          id="node-editor"
          tabIndex={-1}
          className={cn(
            "flex h-full flex-col border-0 shadow-none outline-none",
            isZenMode && "bg-background/95 backdrop-blur-xl",
          )}
        >
          <CardHeader
            className={cn(
              "flex flex-row items-center justify-between space-y-0 pb-2",
              isZenMode &&
                "absolute right-0 top-0 z-10 w-full bg-transparent px-6 py-4",
            )}
          >
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                isZenMode && "hidden",
              )}
            >
              <DialogTitle className="text-lg font-semibold">
                节点编辑
              </DialogTitle>
              <div className="text-xs text-muted-foreground">
                {saveStatus === "saving"
                  ? "保存中..."
                  : syncStatus === "syncing"
                    ? "同步中..."
                    : syncStatus === "failed"
                      ? "同步失败"
                      : saveStatus === "saved" && syncStatus === "completed"
                        ? "已保存并同步"
                        : saveStatus === "saved"
                          ? "本地已保存"
                          : isDirty
                            ? "修改未保存"
                            : null}
              </div>
            </div>
            <div
              className={cn("flex items-center gap-2", isZenMode && "ml-auto")}
            >
              {isZenMode && (
                <div className="mr-4 text-xs text-muted-foreground/60">
                  {saveStatus === "saving"
                    ? "保存中..."
                    : isDirty
                      ? "未保存"
                      : "已保存"}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setIsZenMode(!isZenMode)}
                title={isZenMode ? "退出沉浸模式" : "进入沉浸模式"}
              >
                {isZenMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </Button>
              {!isZenMode && (
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <span className="sr-only">Close</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </Button>
                </DialogClose>
              )}
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              "flex-1 min-h-0 overflow-y-auto",
              isZenMode
                ? "mx-auto w-full max-w-3xl pt-16 pb-12 px-8"
                : "space-y-4 px-6 pb-2",
            )}
          >
            {isZenMode ? (
              <div className="flex h-full flex-col gap-6">
                <input
                  value={title}
                  onChange={handleChange(setTitle)}
                  placeholder="未命名节点"
                  className="bg-transparent text-4xl font-bold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                />
                <textarea
                  value={content}
                  onChange={handleChange(setContent)}
                  placeholder="在此输入内容..."
                  className="flex-1 resize-none bg-transparent text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">状态</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      saveStatus === "saving"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : saveStatus === "saved"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : isDirty
                            ? "bg-muted text-muted-foreground"
                            : "bg-muted text-muted-foreground/60",
                    )}
                  >
                    {saveStatus === "saving"
                      ? "保存中"
                      : saveStatus === "saved"
                        ? "已保存"
                        : isDirty
                          ? "未保存"
                          : "待保存"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5",
                      syncStatus === "syncing"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : syncStatus === "completed"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : syncStatus === "failed"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground/60",
                    )}
                  >
                    {syncStatus === "syncing"
                      ? "同步中"
                      : syncStatus === "completed"
                        ? "已同步"
                        : syncStatus === "failed"
                          ? "同步失败"
                          : "待同步"}
                  </span>
                  {conflicts.length > 0 ? (
                    <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">
                      发现冲突 {conflicts.length}
                    </span>
                  ) : null}
                </div>
                {newCharacterNotice ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    {newCharacterNotice}
                  </div>
                ) : null}
                {validationError ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {validationError}
                  </div>
                ) : null}
                {conflicts.length > 0 ? (
                  <div className="space-y-2">
                    {conflicts.map((conflict, index) => {
                      const isExpanded = expandedConflict === index;
                      const severityClass =
                        conflict.severity === "error"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : conflict.severity === "warning"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400";

                      return (
                        <button
                          type="button"
                          key={conflict._id}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-xs ${severityClass}`}
                          onClick={() =>
                            setExpandedConflict(isExpanded ? null : index)
                          }
                        >
                          <div className="font-semibold">
                            {conflict.description}
                          </div>
                          {isExpanded ? (
                            <div className="mt-2 space-y-1 text-[11px]">
                              <div>
                                涉及节点：{conflict.node_ids.join("、") || "无"}
                              </div>
                              <div>
                                涉及实体：
                                {conflict.entity_ids.join("、") || "无"}
                              </div>
                              {conflict.suggestion ? (
                                <div>建议：{conflict.suggestion}</div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              点击查看详情
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="node-title">
                    标题
                  </label>
                  <Input
                    id="node-title"
                    value={title}
                    onChange={handleChange(setTitle)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="node-content">
                    内容梗概
                  </label>
                  <Textarea
                    id="node-content"
                    rows={8}
                    value={content}
                    onChange={handleChange(setContent)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor="narrative-order"
                    >
                      叙事顺序
                    </label>
                    <Input
                      id="narrative-order"
                      type="number"
                      value={narrativeOrder}
                      onChange={handleChange(setNarrativeOrder)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor="timeline-order"
                    >
                      时间轴位置
                    </label>
                    <Input
                      id="timeline-order"
                      type="number"
                      step="0.1"
                      value={timelineOrder}
                      onChange={handleChange(setTimelineOrder)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="location-tag">
                    泳道标签
                  </label>
                  <Input
                    id="location-tag"
                    value={locationTag}
                    onChange={handleChange(setLocationTag)}
                    placeholder="例如：港口、旧城区"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">涉及角色</p>
                  {characterOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      暂无角色可选
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {characterOptions.map((character) => {
                        const isSelected = characters.includes(character.id);
                        return (
                          <button
                            type="button"
                            key={character.id}
                            onClick={() => handleCharacterToggle(character.id)}
                            className={`
                              inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                              ${
                                isSelected
                                  ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/80"
                                  : "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                              }
                            `}
                          >
                            {character.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
          {!isZenMode && (
            <DialogFooter className="px-6 pb-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={handleManualSave}
                disabled={!isDirty}
              >
                保存并更新 (Ctrl+S)
              </Button>
            </DialogFooter>
          )}
        </Card>
      </DialogContent>
    </Dialog>
  );
}
