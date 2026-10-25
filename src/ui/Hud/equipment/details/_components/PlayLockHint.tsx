import InfoTip from "@/components/InfoTip";
import { PLAY_LOCK_TEXT } from "@/ui/Hud/equipment/details/_components/playLockState";

/** (i) next to a setting that keeps its layout but is locked during Play. */
export default function PlayLockHint() {
  return <InfoTip text={PLAY_LOCK_TEXT} label="잠김 설명" />;
}
