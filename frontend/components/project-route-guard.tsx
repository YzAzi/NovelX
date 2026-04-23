"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useProjectStore } from "@/src/stores/project-store";
import { Button } from "@/components/ui/button";
import { AUTH_EXPIRED_EVENT, getAuthToken } from "@/src/lib/api";

type ProjectRouteGuardProps = {
  projectId: string;
  children: ReactNode;
};

export function ProjectRouteGuard({
  projectId,
  children,
}: ProjectRouteGuardProps) {
  const currentProjectId = useProjectStore(
    (state) => state.currentProject?.id ?? null,
  );
  const loadProject = useProjectStore((state) => state.loadProject);
  const resetWorkspace = useProjectStore((state) => state.resetWorkspace);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootstrappedProjectId, setBootstrappedProjectId] = useState<
    string | null
  >(null);
  const router = useRouter();

  useEffect(() => {
    const handleAuthExpired = () => {
      resetWorkspace();
      router.replace("/");
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    if (!getAuthToken()) {
      handleAuthExpired();
      return () => {
        window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
      };
    }

    Promise.resolve().then(() => setSessionChecked(true));

    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [resetWorkspace, router]);

  useEffect(() => {
    if (!sessionChecked || !projectId) {
      return;
    }

    if (currentProjectId === projectId) {
      Promise.resolve().then(() => {
        setBootError(null);
        setBootstrappedProjectId(projectId);
        setIsBootstrapping(false);
      });
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setBootError(null);
        setBootstrappedProjectId(null);
        setIsBootstrapping(true);
      }
    });

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setBootError("项目加载超时，请检查网络或稍后重试。");
        setIsBootstrapping(false);
      }
    }, 15000);

    void loadProject(projectId)
      .then((project) => {
        if (cancelled) {
          return;
        }
        if (project?.id !== projectId) {
          setBootError("未能加载目标项目，请返回首页后重试。");
          setBootstrappedProjectId(null);
        } else {
          setBootstrappedProjectId(projectId);
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentProjectId, loadProject, projectId, sessionChecked]);

  if (!projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">无效的项目地址。</p>
          <Button asChild variant="outline">
            <Link href="/">返回主页</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (
    !sessionChecked ||
    isBootstrapping ||
    bootstrappedProjectId !== projectId
  ) {
    if (!isBootstrapping && bootError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">{bootError}</p>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                重新加载
              </Button>
              <Button asChild variant="outline">
                <Link href="/">返回主页</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (
      !isBootstrapping &&
      !bootError &&
      sessionChecked &&
      bootstrappedProjectId !== projectId
    ) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              未能定位到当前项目，请返回首页重新进入。
            </p>
            <Button asChild variant="outline">
              <Link href="/">返回主页</Link>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">正在恢复项目…</p>
          <p className="text-xs text-muted-foreground">
            正在根据链接加载项目内容。
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
