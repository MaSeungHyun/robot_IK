import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/stores/useSceneStore";
import Button from "@/components/Button";
import { Undo2,Redo2 } from "lucide-react";

export default function LayoutPanel(){
  const {editing,errors,edit,complete,example,clear}=useSceneStore(useShallow(s=>({editing:s.editing,errors:s.errors,edit:s.edit,complete:s.complete,example:s.example,clear:s.clear})));
  const {undo,redo,canUndo,canRedo}=useSceneStore(useShallow(s=>({undo:s.undo,redo:s.redo,canUndo:s.past.length>0,canRedo:s.future.length>0})));
  return <section className="mt-4 border-t border-white/10 pt-4" aria-label="사용자 배치">
    {editing?<>
      <div className="mb-3 flex gap-2"><Button secondary className="h-8 flex-1 px-2 text-xs" disabled={!canUndo} onClick={undo} aria-label="실행 취소" title="Ctrl Z"><Undo2 size={14}/>취소</Button><Button secondary className="h-8 flex-1 px-2 text-xs" disabled={!canRedo} onClick={redo} aria-label="다시 실행" title="Ctrl Shift Z"><Redo2 size={14}/>다시 실행</Button></div>
      <p className="text-xs leading-5 text-slate-400">에셋을 드래그해 Scene에 추가하세요.<br/>선택한 오브젝트는 오른쪽에서 수정합니다.</p>
      {errors.length>0&&<ul role="alert" className="mt-2 space-y-1 text-[11px] text-amber-300">{errors.map(error=><li key={error}>{error}</li>)}</ul>}
      <div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={complete}>배치 완료</Button><Button secondary onClick={example}>예제 배치</Button></div>
      <button onClick={clear} className="mt-2 text-[11px] text-slate-500">Scene 비우기</button>
    </>:<Button secondary onClick={edit} className="w-full">배치 수정</Button>}
  </section>;
}
