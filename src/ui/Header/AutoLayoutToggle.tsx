import IconButton from "@/components/IconButton";
import { useSceneStore } from "@/stores/useSceneStore";
import { useAutoLayoutStore } from "@/stores/useAutoLayoutStore";

/** Header button that opens the auto-layout panel (edit mode only). */
export default function AutoLayoutToggle() {
  const editing = useSceneStore((state) => state.editing);
  const open = useAutoLayoutStore((state) => state.open);
  if (!editing) return null;
  return (
    <IconButton
      icon="WandSparkles"
      label="자동 설계"
      active={open}
      aria-pressed={open}
      onClick={() => useAutoLayoutStore.getState().setOpen(!open)}
    />
  );
}