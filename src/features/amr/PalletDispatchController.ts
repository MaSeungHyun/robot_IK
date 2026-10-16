import { Group, Vector3 } from "three";
import type { FactoryLayout } from "@/types/layout";
import { CUSTOMIZE_CONFIG, AMR_TRAFFIC } from "@/constants/customize";
import { layoutPath } from "@/utils/amr/layoutNavigation";
import type { NavigationObstacle } from "@/utils/amr/layoutNavigation";

export type DispatchRoutes={pickup:Vector3[];dispatch:Vector3[];returning:Vector3[]};

export class PalletDispatchController {
  readonly carrier = new Group();
  readonly home:Vector3;
  phase: "idle" | "pickup" | "loading" | "dispatch" | "unloading" | "returning" | "blocked" =
    "idle";
  path: Vector3[] = [];
  version = 0;
  yielding = false;
  get moving(){return this.phase==="pickup"||this.phase==="dispatch"||this.phase==="returning";}
  get radius(){return ["loading","dispatch","unloading"].includes(this.phase)?AMR_TRAFFIC.loadedRadius:AMR_TRAFFIC.emptyRadius;}
  radiusAt(point:Vector3){return this.phase==="pickup"&&point.distanceToSquared(this.path[this.path.length-1]??this.carrier.position)<1e-10?AMR_TRAFFIC.loadedRadius:this.radius;}
  predict(delta:number,out:Vector3){
    out.copy(this.carrier.position);
    if(!this.moving)return out;
    let remaining=delta*CUSTOMIZE_CONFIG.amrSpeed;
    for(let i=this.cursor;i<this.path.length&&remaining>0;i++){
      const point=this.path[i],length=out.distanceTo(point);
      if(length<=remaining){out.copy(point);remaining-=length;}
      else{out.lerp(point,remaining/length);break;}
    }
    return out;
  }
  reroute(points:Vector3[]){
    if(!this.moving)return;
    this.path=points;this.cursor=1;this.version++;
  }
  private layout: FactoryLayout;
  private obstacles: NavigationObstacle[] = [];
  private payload: Group | null = null;
  private complete: (() => void) | null = null;
  private cursor = 1;
  private elapsed = 0;
  private routes:DispatchRoutes|null=null;
  constructor(layout: FactoryLayout) {
    this.layout = layout;
    this.home=new Vector3(layout.amr.x,0,layout.amr.z);
    this.carrier.position.set(layout.amr.x, 0, layout.amr.z);
    this.carrier.rotation.y = layout.amr.yaw;
  }
  request(payload: Group, complete: () => void,routes?:DispatchRoutes) {
    if (this.phase !== "idle") throw Error("AMR already has a pallet task");
    this.payload = payload;
    this.complete = complete;
    this.routes=routes??null;
    if(routes)this.follow(routes.pickup,"pickup");else this.route(this.layout.pallet, false, "pickup");
  }
  configure(layout: FactoryLayout, obstacles: NavigationObstacle[] = []) {
    this.layout = layout;
    this.obstacles = obstacles;
  }
  private follow(points:Vector3[],phase:"pickup"|"dispatch"|"returning"){
    this.path=points;this.cursor=1;this.phase=phase;this.version++;
  }
  private route(
    goal: { x: number; z: number },
    loaded: boolean,
    phase: "pickup" | "dispatch",
  ) {
    const points = layoutPath(
      this.layout,
      this.carrier.position,
      goal,
      loaded,
      this.obstacles,
    );
    if (!points) {
      this.phase = "blocked";
      return;
    }
    this.path = points;
    this.cursor = 1;
    this.phase = phase;
    this.version++;
  }
  advance(delta: number) {
    if (this.phase === "idle" || this.phase === "blocked") return;
    if (this.phase === "loading" || this.phase === "unloading") {
      this.elapsed += delta;
      if (this.phase === "loading" && this.payload)
        this.payload.position.y = Math.min(1, this.elapsed / 0.6) * 0.27;
      if (this.elapsed < 0.6) return;
      if (this.phase === "loading"){
        if(this.routes)this.follow(this.routes.dispatch,"dispatch");else this.route(this.layout.dock, true, "dispatch");
      }
      else {
        const complete = this.complete;
        this.complete = null;
        complete?.();
        this.payload = null;
        if(this.routes)this.follow(this.routes.returning,"returning");
        else{this.phase="idle";this.path=[];this.version++;}
      }
      return;
    }
    let distance = delta * CUSTOMIZE_CONFIG.amrSpeed;
    while (distance > 0 && this.cursor < this.path.length) {
      const point = this.path[this.cursor],
        position = this.carrier.position;
      const dx = point.x - position.x,
        dz = point.z - position.z,
        length = Math.hypot(dx, dz);
      if (length < 1e-8) {
        this.cursor++;
        continue;
      }
      // Keep the loaded pallet's world orientation constant through grid turns.
      if (!this.payload || this.payload.parent !== this.carrier)
        this.carrier.rotation.y = Math.atan2(dx, dz);
      if (distance >= length) {
        position.x = point.x;
        position.z = point.z;
        distance -= length;
        this.cursor++;
      } else {
        position.x += (dx / length) * distance;
        position.z += (dz / length) * distance;
        distance = 0;
      }
    }
    if (this.cursor < this.path.length) return;
    this.elapsed = 0;
    if(this.phase==="returning"){
      this.phase="idle";this.path=[];this.routes=null;this.version++;
    }else if (this.phase === "pickup") {
      this.carrier.updateWorldMatrix(true, true);
      this.carrier.attach(this.payload!);
      this.phase = "loading";
    } else this.phase = "unloading";
  }
  get status() {
    if(this.yielding)return "다른 AMR 통과 대기 · 안전거리 확보 후 자동 출발";
    return {
      idle: "완성 팔레트 대기",
      pickup: "완성 팔레트 픽업 지점으로 이동",
      loading: "완성 팔레트 상차",
      dispatch: "완성 팔레트 출고 중",
      unloading: "출고 완료 처리",
      returning:"대기 위치로 복귀 중",
      blocked: "AMR 경로가 막혔습니다. 배치를 수정해 주세요.",
    }[this.phase];
  }
}
