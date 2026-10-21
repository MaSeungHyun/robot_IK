import { Suspense, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { log } from "@/stores/useLogStore";
import { useModelStore } from "@/stores/useModelStore";
import ModelErrorBoundary from "@/viewport/models/ModelErrorBoundary";
import { MODEL_URLS, modelFileName } from "@/viewport/models/modelUrls";

const TIMEOUT_MS = 30_000;

function ModelProbe({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const report = useModelStore((state) => state.report);
  useEffect(() => report(url, scene), [report, url, scene]);
  return null;
}

/**
 * Loads every startup GLB in isolation: a failing file is logged and reported as null instead of
 * taking the whole canvas down; files still pending after TIMEOUT_MS are logged and skipped.
 */
export default function ModelLoader() {
  const report = useModelStore((state) => state.report);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { scenes } = useModelStore.getState();
      for (const url of MODEL_URLS)
        if (!(url in scenes)) {
          log("error", `모델 로드 시간 초과: ${modelFileName(url)}`, `${url} · ${TIMEOUT_MS / 1000}초 내 응답 없음`);
          report(url, null);
        }
    }, TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [report]);

  return MODEL_URLS.map((url) => (
    <ModelErrorBoundary key={url} label={`${modelFileName(url)} (${url})`} onError={() => report(url, null)}>
      <Suspense fallback={null}>
        <ModelProbe url={url} />
      </Suspense>
    </ModelErrorBoundary>
  ));
}
