import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { Box3, Vector3 } from "three";
import amrUrl from "@/assets/models/amr.glb?url";
import { AMR_CONFIG } from "../../../constants/amr";
import { useInstanceModel } from "@/features/Viewport/instancing/useInstanceModel";

export default function AMR() {
  const {scene}=useGLTF(amrUrl);
  const model=useMemo(()=>{
    const model=scene.clone(true),bounds=new Box3().setFromObject(model),size=bounds.getSize(new Vector3());
    model.scale.multiplyScalar(AMR_CONFIG.bodyWidth/Math.max(size.x,size.z));
    bounds.setFromObject(model);
    const center=bounds.getCenter(new Vector3());
    model.position.sub(new Vector3(center.x,bounds.min.y,center.z));
    return model;
  },[scene]);
  useInstanceModel(model);
  return <primitive object={model}/>;
}
