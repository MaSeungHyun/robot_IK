import type { ReactNode } from "react";
import Button from "@/components/Button";
import { cn } from "@/lib/style";
import { useSceneStore } from "@/stores/useSceneStore";
import { useHudStore } from "@/stores/useHudStore";

type Props = {
  id: string;
  name: string;
  children: ReactNode;
  className?: string;
};

export default function EquipmentCard({
  id,
  name,
  children,
  className,
}: Props) {
  const selected = useSceneStore((state) => state.selected === id);
  const select = useSceneStore((state) => state.select);
  const inspect = useSceneStore((state) => state.inspect);
  const selectTab = useHudStore((state) => state.selectInspectorTab);
  const openDetails = () => {
    inspect(id);
    selectTab("details");
  };

  return (
    <Button
      type="button"
      aria-label={name}
      aria-pressed={selected}
      title="클릭: 선택 · 더블클릭 또는 Enter: 상세 정보"
      onClick={() => select(id)}
      onDoubleClick={openDetails}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
          event.preventDefault();
          openDetails();
        }
      }}
      className={cn(
        "block h-auto w-full rounded-xl border p-3 text-left font-normal backdrop-blur-lg",
        selected
          ? "border-brand-primary bg-bg-primary"
          : "border-text-secondary/40 bg-bg-primary/35",
        className,
      )}
    >
      {children}
    </Button>
  );
}
