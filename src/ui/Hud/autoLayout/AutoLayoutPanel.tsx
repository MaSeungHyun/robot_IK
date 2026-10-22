import type { ReactNode } from "react";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import NumberField from "@/components/NumberField";
import ProgressBar from "@/components/ProgressBar";
import Select from "@/components/Select";
import { cn } from "@/lib/style";
import type { Wall } from "@/domain/layout/autoLayout";
import type { EvaluatedCandidate } from "@/domain/layout/searchLayouts";
import { applySceneTemplate } from "@/stores/actions/applySceneTemplate";
import { useAutoLayoutStore, type AutoLayoutForm } from "@/stores/useAutoLayoutStore";
import { useSceneStore } from "@/stores/useSceneStore";
import { scheduleDropIn } from "@/viewport/editor/dropIn";
import TemplatePreview from "@/ui/Hud/template/TemplatePreview";

const input =
  "h-6 w-24 min-w-0 rounded-[3px] border border-[#2c2e33] bg-[#1b1c1f] px-2 text-right text-xs tabular-nums text-text-primary outline-none hover:border-[#3a3d43] focus:border-brand-primary disabled:opacity-40";
const DOORS: { value: Wall | "none"; label: string }[] = [
  { value: "none", label: "없음" }, { value: "south", label: "남쪽 벽" }, { value: "north", label: "북쪽 벽" },
  { value: "east", label: "동쪽 벽" }, { value: "west", label: "서쪽 벽" },
];
/** Shared Button focus ring is sky; keep the brand accent here. */
const RING = "focus-visible:ring-1 focus-visible:ring-brand-primary";
const fixed1 = (value: number) => value.toFixed(1);
const int = (value: number) => Math.round(value).toLocaleString("ko-KR");

/** Docked in the right properties column (replaces object properties while open): constraints form -> worker search -> candidate cards. */
export default function AutoLayoutPanel() {
  const { form, status, progress, result, error, setForm, start, cancel, setOpen } = useAutoLayoutStore();
  const running = status === "running";
  const field = (key: keyof AutoLayoutForm, label: string, unit: string, opts: { integer?: boolean; min?: number; max?: number } = {}) => (
    <NumberField
      label={label} unit={unit} value={form[key] as number} integer={opts.integer} min={opts.min ?? 0} max={opts.max}
      decimals={opts.integer ? 0 : 1} fixedDecimals={!opts.integer} disabled={running}
      inputClassName={input} onCommit={(value) => setForm({ [key]: value } as Partial<AutoLayoutForm>)}
    />
  );
  return (
    <aside
      aria-label="자동 설계"
      className="simulation-panel flex min-h-0 flex-1 flex-col overflow-hidden text-text-primary"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold">자동 설계</h2>
        <IconButton icon="X" label="닫기" onClick={() => { if (running) cancel(); setOpen(false); }} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-1.5 px-3 py-3">
          <Section title="공장">
            {field("width", "너비", "m", { min: 5, max: 500 })}
            {field("depth", "깊이", "m", { min: 5, max: 500 })}
            {field("height", "높이", "m", { min: 0, max: 30 })}
          </Section>
          <Section title="설계 방식">
            <ModeToggle value={form.mode} disabled={running} onChange={(mode) => setForm({ mode })} />
            <p className="text-[11px] text-text-secondary">
              {form.mode === "fixed" ? "입력한 장비를 공장 안에 모두 배치하고 처리량이 가장 높은 배치를 찾습니다." : "목표 처리량을 가장 적은 장비로 만족하는 배치를 찾습니다."}
            </p>
          </Section>
          {form.mode === "fixed" ? (
            <Section title="장비 수량">
              {field("fixedRobots", "로봇", "대", { integer: true, min: 1, max: 60 })}
              {field("fixedAmrs", "AMR", "대", { integer: true, min: 1, max: 30 })}
              {field("fixedRacks", "랙", "대", { integer: true, min: 0, max: 80 })}
              {field("fixedDocks", "도크", "대", { integer: true, min: 1, max: 6 })}
            </Section>
          ) : (
            <Section title="생산 · 보관">
              {field("targetPerHour", "목표 처리량", "박스/h", { integer: true, min: 1, max: 20000 })}
              {field("storageHours", "랙 보관 시간", "h", { min: 0.1, max: 72 })}
            </Section>
          )}
          <Section title="출입문 (선택)">
            <label className="flex items-center justify-between text-xs text-text-secondary">
              <span>위치</span>
              <Select label="출입문 벽" value={form.door} options={DOORS} widthClassName="w-24" onValueChange={(door) => setForm({ door })} />
            </label>
            {form.door !== "none" && field("doorOffset", "벽 중심에서", "m", { min: -250, max: 250 })}
            {form.door !== "none" && field("doorWidth", "폭", "m", { min: 1, max: 20 })}
          </Section>
          {form.mode === "target" && <Section title="장비 한도 (선택)">
            {field("maxRobots", "최대 로봇", "대", { integer: true, min: 1, max: 40 })}
            {field("maxAmrs", "최대 AMR", "대", { integer: true, min: 1, max: 20 })}
            {field("maxRacks", "최대 랙 (0=제한 없음)", "대", { integer: true, min: 0, max: 60 })}
          </Section>}
          {running ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <ProgressBar label="후보 평가 진행률" value={progress.total ? (progress.evaluated / progress.total) * 100 : 0} tone="info" />
              <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span className="truncate">{progress.current}</span>
                <span className="shrink-0 tabular-nums">{int(progress.evaluated)} / {int(progress.total)}</span>
              </div>
              <Button className={RING} onClick={cancel}>취소</Button>
            </div>
          ) : (
            <Button fill className={cn("mt-2", RING)} onClick={start}>배치 생성</Button>
          )}
          {error && <p className="text-xs text-fault">오류: {error}</p>}
        </div>
        {result && <Results />}
      </div>
    </aside>
  );
}

const MODES: { value: AutoLayoutForm["mode"]; label: string }[] = [{ value: "target", label: "목표 처리량" }, { value: "fixed", label: "장비 수량 고정" }];
/** Segmented toggle; active segment uses the brand accent (never blue). */
function ModeToggle({ value, disabled, onChange }: { value: AutoLayoutForm["mode"]; disabled?: boolean; onChange: (mode: AutoLayoutForm["mode"]) => void }) {
  return (
    <div role="radiogroup" aria-label="설계 방식" className="grid grid-cols-2 gap-0.5 rounded-[4px] border border-[#2c2e33] bg-[#1b1c1f] p-0.5">
      {MODES.map((mode) => (
        <button
          key={mode.value} type="button" role="radio" aria-checked={value === mode.value} disabled={disabled}
          onClick={() => onChange(mode.value)}
          className={cn(
            "h-6 rounded-[3px] text-xs transition-colors outline-none disabled:opacity-40", RING,
            value === mode.value ? "bg-brand-primary/15 text-brand-primary" : "text-text-secondary hover:bg-white/5 hover:text-text-primary",
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-white/5 pt-2 first:border-0 first:pt-0">
      <legend className="mb-1 text-[11px] font-medium text-text-secondary/80">{title}</legend>
      {children}
    </fieldset>
  );
}

function Results() {
  const result = useAutoLayoutStore((state) => state.result)!;
  const ok = result.diagnosis.code === "ok";
  const fixedMode = result.constraints.mode === "fixed";
  return (
    <div className="flex flex-col gap-2 border-t border-white/10 px-3 py-3">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>후보 {int(result.evaluated)}개 평가{result.cancelled ? " (취소됨)" : ""}</span>
        <span className="tabular-nums">랙 필요 {int(result.storage.needed)}대 · {int(result.storage.pallets)}팔레트</span>
      </div>
      {ok && fixedMode && <p role="status" className="text-[11px] text-text-secondary">{result.diagnosis.message}</p>}
      {!ok && (
        <p role="status" className="rounded-lg border border-warning/25 bg-warning/10 p-2 text-xs text-warning">{result.diagnosis.message}</p>
      )}
      {!ok && result.closest && <p className="text-[11px] text-text-secondary">가장 가까운 후보:</p>}
      {!ok && result.closest && <CandidateCard entry={result.closest} rank={0} />}
      {result.ranked.filter((entry) => entry !== result.closest).map((entry, i) => <CandidateCard key={entry.candidate.template.id} entry={entry} rank={i + 1} fixedMode={fixedMode} />)}
    </div>
  );
}

function CandidateCard({ entry, rank, fixedMode = false }: { entry: EvaluatedCandidate; rank: number; fixedMode?: boolean }) {
  const m = entry.metrics!, c = entry.candidate;
  const apply = () => {
    const scene = useSceneStore.getState();
    if (!scene.editing) scene.edit();
    if (applySceneTemplate(c.template)) scheduleDropIn(useSceneStore.getState().objects);
  };
  const stats: [string, string][] = [
    ["처리량", `${int(m.placedPerHour)}/h`], ["로봇 가동률", `${fixed1(m.robotUtilization * 100)}%`],
    ["로봇 · AMR · 컨베이어", `${int(c.counts.robots)} · ${int(c.counts.amrs)} · ${int(c.counts.conveyors)}`],
    ["랙 · 보관 슬롯", `${int(c.counts.racks)} · ${int(c.storage.slots)}/${int(c.storage.required)}`],
    ["면적", `${fixed1(c.usedArea)}m²`], ["교차 · AMR 이동", `${int(c.crossings)} · ${fixed1(c.travel)}m`], ["팔레트→랙 거리", `${fixed1(c.rackDistance)}m`],
  ];
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[.035] p-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-xs font-medium">{rank ? `#${rank} ` : ""}{c.template.name}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {fixedMode ? <Badge tone="safe">고정 장비</Badge> : <Badge tone={entry.met ? "safe" : "warning"}>{entry.met ? "목표 달성" : "미달"}</Badge>}
          <span className="text-[11px] tabular-nums text-text-secondary" title="점수 (낮을수록 좋음)">{fixed1(entry.score)}</span>
        </div>
      </div>
      <TemplatePreview template={c.template} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {stats.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="truncate text-text-secondary">{label}</dt>
            <dd className={cn("shrink-0 tabular-nums")}>{value}</dd>
          </div>
        ))}
      </dl>
      <Button className={cn("h-7 text-xs", RING)} onClick={apply}>이 배치 적용</Button>
    </article>
  );
}
