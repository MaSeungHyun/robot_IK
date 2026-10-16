import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/style";

export default function Button({ secondary=false, className="", ...props }: ButtonHTMLAttributes<HTMLButtonElement>&{secondary?:boolean}) {
  return <button {...props} className={cn("flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-40",secondary?"border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10":"bg-sky-400 text-slate-950 hover:bg-sky-300",className)} />;
}
