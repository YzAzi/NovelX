"use client"

import { useCallback, useEffect, useState } from "react"

import type { WorldDocument } from "@/src/types/models"
import { updateWorldDocument } from "@/src/lib/api"
import { useProjectStore } from "@/src/stores/project-store"
import { KnowledgeEditor } from "@/components/knowledge-editor"
import { KnowledgeManager } from "@/components/knowledge-manager"
import { KnowledgeUpload } from "@/components/knowledge-upload"

export function KnowledgeWorkspace() {
  const { currentProject } = useProjectStore()
  const [selectedDocument, setSelectedDocument] = useState<WorldDocument | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  useEffect(() => {
    setSelectedDocument(null)
    setRefreshSignal((prev) => prev + 1)
  }, [currentProject?.id])

  const handleSave = useCallback(
    async (content: string) => {
      if (!currentProject || !selectedDocument) {
        return
      }
      const updated = await updateWorldDocument(
        currentProject.id,
        selectedDocument.id,
        { content }
      )
      setSelectedDocument(updated)
      setRefreshSignal((prev) => prev + 1)
    },
    [currentProject, selectedDocument]
  )

  const handleUploaded = useCallback(() => {
    setRefreshSignal((prev) => prev + 1)
  }, [])

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid h-full gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <KnowledgeUpload onUploaded={handleUploaded} />
          <KnowledgeManager
            selectedDocumentId={selectedDocument?.id ?? null}
            onSelectDocument={setSelectedDocument}
            refreshSignal={refreshSignal}
          />
        </div>
        <KnowledgeEditor doc={selectedDocument} onSave={handleSave} />
      </div>
    </div>
  )
}
