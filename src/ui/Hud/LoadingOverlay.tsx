import { useProgress } from "@react-three/drei";

export default function LoadingOverlay() {
  const active = useProgress((state) => state.active);
  return active ? (
    <p
      role="status"
      className="pointer-events-none absolute right-5 top-5 z-30 rounded-xl bg-slate-900/90 px-4 py-3 text-sm text-text-primary"
    >
      모델 불러오는 중…
    </p>
  ) : null;
}
