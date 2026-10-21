import { Component } from "react";
import type { ReactNode } from "react";
import { log } from "@/stores/useLogStore";

type Props = { children: ReactNode; label: string; fallback?: ReactNode; onError?: () => void };

/** Catches a failed model load/build below it: logs it once and renders the fallback. */
export default class ModelErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    log("error", `모델 로드 실패: ${this.props.label}`, error instanceof Error ? error.message : String(error));
    this.props.onError?.();
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
