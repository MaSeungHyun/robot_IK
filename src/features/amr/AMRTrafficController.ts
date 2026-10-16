import { Vector3 } from "three";
import { AMR_TRAFFIC } from "@/constants/customize";
import type { PalletDispatchController } from "@/features/amr/PalletDispatchController";

type Vehicle={id:string;dispatch:PalletDispatchController;speed:number;enabled:boolean};
type Motion={next:Vector3;ahead:Vector3;allowed:boolean;wait:number;retry:number};

// Closest separation of two swept discs, including crossings between frames.
function separation(a:Vector3,b:Vector3,c:Vector3,d:Vector3){
  const x=a.x-c.x,z=a.z-c.z,dx=b.x-a.x-d.x+c.x,dz=b.z-a.z-d.z+c.z;
  const length=dx*dx+dz*dz,t=length?Math.max(0,Math.min(1,-(x*dx+z*dz)/length)):0;
  return Math.hypot(x+dx*t,z+dz*t);
}

/** Paths may overlap. Only nearby predicted body conflicts stop a vehicle. */
export class AMRTrafficController{
  private motions=new Map<string,Motion>();
  advance(vehicles:Vehicle[],delta:number,replan:(vehicle:Vehicle)=>Vector3[]|null){
    const steps=Math.max(1,Math.ceil(delta/(1/30))),dt=delta/steps;
    for(const vehicle of vehicles)if(!this.motions.has(vehicle.id))this.motions.set(vehicle.id,{next:new Vector3(),ahead:new Vector3(),allowed:false,wait:0,retry:0});
    for(let step=0;step<steps;step++){
      for(const vehicle of vehicles){
        const motion=this.motions.get(vehicle.id)!;
        motion.allowed=vehicle.enabled;motion.retry-=dt;
        vehicle.dispatch.predict(vehicle.enabled?dt*vehicle.speed:0,motion.next);
        vehicle.dispatch.predict(vehicle.enabled?.8*vehicle.speed:0,motion.ahead);
        vehicle.dispatch.yielding=false;
      }
      // Stable vehicle order resolves ties; a returning vehicle first clears the shared dock.
      const priority=(a:Vehicle,b:Vehicle)=>Number(b.dispatch.phase==="returning")-Number(a.dispatch.phase==="returning")||a.id.localeCompare(b.id);
      for(let i=0;i<vehicles.length;i++)for(let j=i+1;j<vehicles.length;j++){
        const a=vehicles[i],b=vehicles[j],ma=this.motions.get(a.id)!,mb=this.motions.get(b.id)!;
        if(!a.dispatch.moving||!b.dispatch.moving)continue;
        if(separation(a.dispatch.carrier.position,ma.ahead,b.dispatch.carrier.position,mb.ahead)<a.dispatch.radius+b.dispatch.radius+AMR_TRAFFIC.safetyMargin){
          (priority(a,b)<=0?mb:ma).allowed=false;
        }
      }
      // Recheck after every stop: the winner must also clear the stopped vehicle's actual body.
      for(let pass=0;pass<vehicles.length;pass++){
        let changed=false;
        for(let i=0;i<vehicles.length;i++)for(let j=i+1;j<vehicles.length;j++){
          const a=vehicles[i],b=vehicles[j],ma=this.motions.get(a.id)!,mb=this.motions.get(b.id)!;
          const pa=a.dispatch.carrier.position,pb=b.dispatch.carrier.position;
          if(separation(pa,ma.allowed?ma.next:pa,pb,mb.allowed?mb.next:pb)>=a.dispatch.radiusAt(ma.allowed?ma.next:pa)+b.dispatch.radiusAt(mb.allowed?mb.next:pb)+AMR_TRAFFIC.safetyMargin-1e-8)continue;
          const movingA=ma.allowed&&a.dispatch.moving,movingB=mb.allowed&&b.dispatch.moving;
          const loser=movingA&&movingB?(priority(a,b)<=0?mb:ma):movingA?ma:movingB?mb:null;
          if(loser){loser.allowed=false;changed=true;}
        }
        if(!changed)break;
      }
      // If the preferred vehicle is itself blocked, let a safe escape/detour move first.
      // Otherwise a slower yielding vehicle can be prevented from clearing the winner's way.
      for(const vehicle of vehicles){
        const motion=this.motions.get(vehicle.id)!,dispatch=vehicle.dispatch;
        if(motion.allowed||!vehicle.enabled||!dispatch.moving)continue;
        const blockedPeer=vehicles.some(other=>other!==vehicle&&other.enabled&&other.dispatch.moving&&!this.motions.get(other.id)!.allowed);
        if(!blockedPeer)continue;
        const safe=vehicles.every(other=>{
          if(other===vehicle)return true;
          const peer=this.motions.get(other.id)!,position=other.dispatch.carrier.position;
          return separation(dispatch.carrier.position,motion.next,position,peer.allowed?peer.next:position)>=dispatch.radiusAt(motion.next)+other.dispatch.radiusAt(peer.allowed?peer.next:position)+AMR_TRAFFIC.safetyMargin-1e-8;
        });
        if(safe)motion.allowed=true;
      }
      for(const vehicle of vehicles){
        const motion=this.motions.get(vehicle.id)!,dispatch=vehicle.dispatch;
        if(!vehicle.enabled)continue;
        if(motion.allowed){dispatch.advance(dt*vehicle.speed);motion.wait=0;}
        else if(dispatch.moving){
          dispatch.yielding=true;motion.wait+=dt;
          // Opposing traffic can otherwise deadlock. Find a safe detour around current bodies.
          if(motion.wait>=.8&&motion.retry<=0){
            motion.retry=1;
            const path=replan(vehicle);if(path)dispatch.reroute(path);
          }
        }
      }
    }
  }
}
