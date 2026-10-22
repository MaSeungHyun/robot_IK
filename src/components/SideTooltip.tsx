/**
 * CSS tooltip fixed to the right of its parent (vertically centered). The parent needs
 * `relative group/tip`. Used instead of the native `title` tooltip, which appears at the cursor.
 */
export default function SideTooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-300 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-normal text-white opacity-0 shadow transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
    >
      {label}
    </span>
  );
}