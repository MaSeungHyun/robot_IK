import Badge from "@/components/Badge";
import IconButton from "@/components/IconButton";

type Props = {
  lineName: string;
  running: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
};

/** Title row (PRODUCTION LINE + expand/close) and the line name with its run state. */
export default function LineOverviewHeader({ lineName, running, expanded, onToggleExpanded, onClose }: Props) {
  return (
    <header className="flex items-center flex-col">
      <div className=" flex justify-between min-w-0 w-full">
        <p className="text-sm font-bold tracking-wider text-text-primary ">
          PRODUCTION LINE
        </p>
        <div>
          <IconButton
            icon={expanded ? "Minimize2" : "Maximize2"}
            label={expanded ? "축소" : "확대"}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          />
          <IconButton icon="X" label="닫기" onClick={onClose} />
        </div>
      </div>
      <div className="mt-2 flex shrink-0 justify-between items-center w-full">
        <h2 className="truncate text-sm font-semibold text-text-primary" title={lineName}>
          {lineName}
        </h2>
        <Badge tone={running ? "operating" : "idle"}>
          {running ? "가동 중" : "일시 정지"}
        </Badge>
      </div>
    </header>
  );
}
