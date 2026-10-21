import Icon from "@/components/Icon";
import ModeSelect from "@/ui/Header/ModeSelect";
import InspectorTabs from "@/ui/Header/InspectorTabs";

export default function Header() {
  return (
    <header
      aria-label="애플리케이션 헤더"
      className="pointer-events-auto relative grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-brand-primary/10 bg-bg-primary/85 px-3 text-text-primary backdrop-blur-sm max-lg:h-auto max-lg:min-h-12 max-lg:grid-cols-2 max-lg:py-2"
    >
      <Logo />
      <ModeSelect />
      <div className="flex min-w-0 justify-end max-lg:col-span-2">
        <InspectorTabs />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 px-1">
      <Icon
        icon="Box"
        aria-hidden="true"
        className="size-5 text-brand-primary"
      />
      <p className="truncate text-md font-semibold tracking-wider">
        SMART FACTORY
      </p>
    </div>
  );
}
