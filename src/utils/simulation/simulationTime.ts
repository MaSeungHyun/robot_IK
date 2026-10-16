import { MOTION } from "@/constants/simulation";

/** Clamp frame stalls before applying playback and equipment multipliers. */
export function simulationDelta(delta:number,playback=1,equipment=1){
  return Math.min(delta,MOTION.maxDelta)*playback*equipment;
}
