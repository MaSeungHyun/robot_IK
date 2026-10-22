import { Dialog, Tabs } from "radix-ui";
import Icon from "@/components/Icon";
import { useDashboardStore } from "@/stores/useDashboardStore";
import { useSimulationStore } from "@/stores/useSimulationStore";
import OverviewTab from "@/ui/Hud/dashboard/full/OverviewTab";
import HistoryTab from "@/ui/Hud/dashboard/full/HistoryTab";
import EquipmentTab from "@/ui/Hud/dashboard/full/EquipmentTab";
import TrendTab from "@/ui/Hud/dashboard/full/TrendTab";
import { fmtTime } from "@/ui/Hud/dashboard/full/format";

const TABS = [
  { id: "overview", label: "개요" },
  { id: "history", label: "처리 내역" },
  { id: "equipment", label: "설비" },
  { id: "trend", label: "추이" },
] as const;

const TAB_TRIGGER =
  "relative h-8 px-3 text-xs text-text-secondary outline-none transition-colors hover:text-text-primary data-[state=active]:text-text-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary";

/**
 * Full dashboard over the area below the header (h-10). The simulation keeps running underneath;
 * data comes from the 1 Hz dashboard snapshot (useDashboardStore).
 */
export default function DashboardDialog() {
  const open = useDashboardStore((s) => s.open);
  const setOpen = useDashboardStore((s) => s.setOpen);
  const data = useDashboardStore((s) => s.snapshot);
  const running = useSimulationStore((s) => s.running);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-x-0 top-10 bottom-0 z-500 bg-bg-primary/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-14 right-4 bottom-4 left-4 z-500 flex min-h-0 flex-col rounded-[3px] border border-white/10 bg-bg-primary text-text-primary outline-none"
        >
          <Tabs.Root defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-4 border-b border-white/10 pl-4 pr-2">
              <Dialog.Title className="text-sm font-semibold">대시보드</Dialog.Title>
              <Tabs.List aria-label="대시보드 탭" className="flex">
                {TABS.map((tab) => (
                  <Tabs.Trigger key={tab.id} value={tab.id} className={TAB_TRIGGER}>{tab.label}</Tabs.Trigger>
                ))}
              </Tabs.List>
              <p className="ml-auto text-[11px] tabular-nums text-text-secondary">
                시뮬레이션 {fmtTime(data?.elapsed)} · {running ? "실행 중" : "정지"}
              </p>
              <Dialog.Close
                aria-label="대시보드 닫기"
                className="flex size-7 items-center justify-center rounded-md text-text-secondary outline-none hover:bg-white/10 hover:text-text-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
              >
                <Icon icon="X" aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto scrollbar-thin p-4">
              {TABS.map((tab) => (
                <Tabs.Content key={tab.id} value={tab.id} className="flex min-h-0 flex-1 flex-col outline-none">
                  {tab.id === "history" ? (
                    <HistoryTab />
                  ) : !data ? (
                    <p className="p-6 text-center text-xs text-text-secondary">시뮬레이션을 실행하면 지표가 수집됩니다.</p>
                  ) : tab.id === "overview" ? (
                    <OverviewTab data={data} />
                  ) : tab.id === "equipment" ? (
                    <EquipmentTab data={data} />
                  ) : (
                    <TrendTab data={data} />
                  )}
                </Tabs.Content>
              ))}
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}