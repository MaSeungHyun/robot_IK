import { Popover } from "radix-ui";
import Button from "@/components/Button";
import Icon from "@/components/Icon";
import ShadowQualitySelect from "@/ui/Hud/simulation/ShadowQualitySelect";

/** Header dropdown for simulation/view settings; KPIs live in the Dashboard tab. */
export default function SettingsMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button aria-label="Settings" className="h-8 px-2 text-xs">
          <Icon icon="Settings" aria-hidden="true" className="size-3.5" />
          Settings
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          aria-label="시뮬레이션 설정"
          className="z-50 w-64 rounded-md border border-brand-primary/20 bg-bg-primary/95 p-3 text-text-primary shadow-2xl backdrop-blur-md"
        >
          <h2 className="text-sm font-semibold">시뮬레이션 설정</h2>
          <ShadowQualitySelect />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
