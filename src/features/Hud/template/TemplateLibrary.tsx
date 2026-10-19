import Button from "@/components/Button";
import Icon from "@/components/Icon";
import { SCENE_TEMPLATES } from "@/constants/sceneTemplates";
import TemplatePreview from "@/features/Hud/template/TemplatePreview";
import { applySceneTemplate } from "@/features/simulator/templates/applySceneTemplate";

export default function TemplateLibrary() {
  return (
    <div aria-label="템플릿 목록" className="space-y-3">
      <p className="text-xs leading-5 text-text-secondary">현재 배치를 교체합니다. 불러온 배치는 자유롭게 수정하고 Ctrl+Z로 되돌릴 수 있습니다.</p>
      {SCENE_TEMPLATES.map((template) => (
        <article key={template.id} aria-label={template.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
          <TemplatePreview template={template} />
          <div className="mt-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">{template.name}</h3>
            <span className="shrink-0 text-[10px] text-text-secondary">{template.equipment.length}개 설비</span>
          </div>
          <p className="my-2 text-[11px] leading-5 text-text-secondary">{template.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button aria-label={`${template.name} 불러오기`} className="px-2 text-xs" onClick={() => applySceneTemplate(template)}>불러오기</Button>
            <Button aria-label={`${template.name} 바로 실행`} fill className="px-2 text-xs" onClick={() => applySceneTemplate(template, true)}><Icon icon="Play" className="size-3" />바로 실행</Button>
          </div>
        </article>
      ))}
    </div>
  );
}
