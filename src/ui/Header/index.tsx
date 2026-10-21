import Icon from "@/components/Icon";
import PlaybackControls from "@/ui/Header/PlaybackControls";
import InspectorTabs from "@/ui/Header/InspectorTabs";
import SettingsMenu from "@/ui/Header/SettingsMenu";
import Box from "@/components/Box";

export default function Header() {
  return (
    <header
      aria-label="애플리케이션 헤더"
      className="pointer-events-auto relative grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-brand-primary/10 bg-bg-primary/85 px-2 text-text-primary backdrop-blur-sm max-lg:h-auto max-lg:min-h-12 max-lg:grid-cols-2 max-lg:py-2"
    >
      <Logo />
      <PlaybackControls />
      <div className="flex min-w-0 items-center justify-end gap-2 max-lg:col-span-2">
        <InspectorTabs />
        <SettingsMenu />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <Box className="size-8 bg-brand-primary/20">
        <Icon
          icon="Box"
          aria-hidden="true"
          className="size-5 text-brand-primary"
        />
      </Box>
      <p className="truncate text-md font-semibold tracking-wider">
        SMART FACTORY
      </p>
    </div>
  );
}
