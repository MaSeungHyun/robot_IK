import { Component } from "react";
import type { ReactNode } from "react";

export default class SceneBoundary extends Component<
  { children: ReactNode; resetKey: number },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { resetKey: number }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <p
        role="alert"
        className="absolute bottom-6 right-6 rounded-xl bg-slate-900 p-4 text-sm text-rose-300"
      >
        모델을 불러오지 못했습니다. 초기화 후 다시 시도해 주세요.
      </p>
    ) : (
      this.props.children
    );
  }
}

