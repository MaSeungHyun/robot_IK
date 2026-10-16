import { useEffect } from "react";
import { useSceneStore } from "../stores/useSceneStore";

export default function useEditorShortcuts(enabled:boolean){
  useEffect(()=>{
    if(!enabled)return;
    const keydown=(event:KeyboardEvent)=>{
      const state=useSceneStore.getState();
      if(!state.editing||event.isComposing||event.defaultPrevented)return;
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
      if(document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]'))return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){
        event.preventDefault();if(event.shiftKey)state.redo();else state.undo();
      }else if((event.key==="Delete"||event.key==="Backspace")&&state.selected){
        event.preventDefault();state.remove(state.selected);
      }
    };
    window.addEventListener("keydown",keydown);
    return()=>window.removeEventListener("keydown",keydown);
  },[enabled]);
}
