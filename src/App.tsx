import Hud from "@/features/Hud";
import Viewport from "@/features/Viewport";

function App() {
  return (
    <main
      aria-label="시뮬레이션 작업 영역"
      className="relative h-dvh w-full min-w-0 overflow-hidden bg-slate-950 text-white"
    >
      <Viewport />
      <Hud />
    </main>
  );
}

export default App;
