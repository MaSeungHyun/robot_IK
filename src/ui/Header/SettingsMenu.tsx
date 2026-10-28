import { Popover } from "radix-ui";
import IconButton from "@/components/IconButton";
import ShadowQualitySelect from "@/ui/Hud/simulation/ShadowQualitySelect";
import RenderQualitySelect from "@/ui/Hud/simulation/RenderQualitySelect";
import CeilingSelect from "@/ui/Hud/simulation/CeilingSelect";
import KpiSettings from "@/ui/Hud/simulation/KpiSettings";
import AutoConnectSelect from "@/ui/Hud/simulation/AutoConnectSelect";

/** Header dropdown for simulation/view settings; KPIs live in the Dashboard tab. */
export default function SettingsMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton icon="Settings" label="설정" tooltipSide="bottom" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          aria-label="시뮬레이션 설정"
          className="z-50 w-64 rounded-md border border-brand-primary/20 bg-bg-primary/95 p-3 text-text-primary shadow-2xl backdrop-blur-md"
        >
          <h2 className="text-sm font-semibold">시뮬레이션 설정</h2>
          <RenderQualitySelect />
          <ShadowQualitySelect />
          <CeilingSelect />
          <AutoConnectSelect />
          <KpiSettings />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
