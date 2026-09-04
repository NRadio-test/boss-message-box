import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { Button } from "./Button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Application render failed", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="boot-state" role="alert">
        <h1>页面没有正常打开</h1>
        <p>请先重新加载。若仍无法打开，请更新微信，或在右上角选择用系统浏览器打开。</p>
        <Button
          icon={<ArrowClockwise aria-hidden="true" />}
          onClick={() => window.location.reload()}
        >
          重新加载
        </Button>
      </main>
    );
  }
}
