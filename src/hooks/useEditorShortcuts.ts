import { useEffect } from "react";
import { selectedIds, useSceneStore } from "../stores/useSceneStore";
import { useModalTransformStore, type ModalMode } from "../stores/useModalTransformStore";
import { useLinkModeStore } from "../stores/useLinkModeStore";

function begin(mode: ModalMode, id: string, created = false) {
  const object = useSceneStore.getState().objects.find((entry) => entry.id === id);
  if (!object) return;
  useModalTransformStore.getState().begin({ mode, id, origin: { x: object.x, z: object.z, yaw: object.yaw }, created });
}

function paste(source: ReturnType<typeof useModalTransformStore.getState>["clipboard"]) {
  if (!source) return;
  const id = useSceneStore.getState().duplicate(source.object, source.settings);
  if (id) begin("move", id, true);
}

export default function useEditorShortcuts(enabled:boolean){
  useEffect(()=>{
    if(!enabled)return;
    const keydown=(event:KeyboardEvent)=>{
      const state=useSceneStore.getState();
      if(!state.editing||event.isComposing||event.defaultPrevented)return;
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
      if(document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]'))return;
      const modal=useModalTransformStore.getState();
      if(modal.session)return; // ModalTransform owns the keyboard while G/R is active.
      const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
      const selected=state.selected?state.objects.find(object=>object.id===state.selected):undefined;
      if(mod&&key==="z"){
        event.preventDefault();if(event.shiftKey)state.redo();else state.undo();
      }else if(mod&&key==="c"&&selected){
        event.preventDefault();modal.copy({object:selected,settings:state.settings[selected.id]});
      }else if(mod&&key==="v"&&modal.clipboard&&!state.pending){
        event.preventDefault();paste(modal.clipboard);
      }else if(mod&&key==="d"&&selected&&!state.pending){
        event.preventDefault();paste({object:selected,settings:state.settings[selected.id]});
      }else if(!mod&&!event.altKey&&(key==="g"||key==="r")&&selected&&!state.pending){
        event.preventDefault();begin(key==="g"?"move":"rotate",selected.id);
      }else if(!mod&&!event.altKey&&key==="l"){
        event.preventDefault();useLinkModeStore.getState().toggle();
      }else if(!mod&&!event.altKey&&key==="w"){
        event.preventDefault();useLinkModeStore.getState().setActive(false);state.setTool("select");
      }else if(event.key==="Escape"&&useLinkModeStore.getState().active){
        const link=useLinkModeStore.getState();
        event.preventDefault();if(link.source||link.selectedLink){link.setSource(null);link.selectLink(null);}else link.setActive(false);
      }else if((event.key==="Delete"||event.key==="Backspace")&&useLinkModeStore.getState().selectedLink){
        event.preventDefault();state.removeLink(useLinkModeStore.getState().selectedLink!);
      }else if(event.key==="Escape"&&state.tool!=="select"){
        // Last step of the Esc chain: fall back to the Select tool. The (multi-)selection is kept;
        // clicking empty space clears it.
        event.preventDefault();state.setTool("select");
      }else if((event.key==="Delete"||event.key==="Backspace")&&state.selected){
        event.preventDefault();state.removeMany(selectedIds(state));
      }
    };
    window.addEventListener("keydown",keydown);
    return()=>window.removeEventListener("keydown",keydown);
  },[enabled]);
}
