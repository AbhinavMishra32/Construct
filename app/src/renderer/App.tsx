import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type RuntimeInfo = {
  name: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
};

type RunnerHealth = {
  status: string;
  service: string;
  port: number;
};

declare global {
  interface Window {
    construct: {
      getRuntimeInfo: () => RuntimeInfo;
    };
  }
}

const runtimeInfo = window.construct.getRuntimeInfo();

export default function App(): JSX.Element {
  const [runnerHealth, setRunnerHealth] = useState<RunnerHealth | null>(null);
  const [runnerError, setRunnerError] = useState<string>("");

  useEffect(() => {
    const controller = new AbortController();

    const loadRunnerHealth = async () => {
      try {
        const response = await fetch("http://127.0.0.1:43110/health", {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Runner responded with ${response.status}.`);
        }

        const payload = (await response.json()) as RunnerHealth;
        setRunnerHealth(payload);
        setRunnerError("");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setRunnerHealth(null);
        setRunnerError(
          error instanceof Error ? error.message : "Runner is not reachable."
        );
      }
    };

    void loadRunnerHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.28),_transparent_40%),linear-gradient(180deg,_#07101d_0%,_#0b1324_100%)] px-8 py-10 text-slate-100">
      <motion.section
        className="mx-auto flex max-w-6xl flex-col gap-6"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <header className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <span className="text-sm uppercase tracking-[0.35em] text-teal-300">
            Construct
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white">
              Local-first developer training for real systems, starting with the
              Phase 0 scaffold.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300">
              The desktop shell, runner process, shared schemas, and canonical
              sample project are now wired into a single workspace. Phase 2 can
              build on this foundation with file management and snapshots.
            </p>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="grid gap-5 md:grid-cols-2">
            <article className="rounded-[24px] border border-white/10 bg-slate-950/40 p-6">
              <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Runtime
              </h2>
              <dl className="mt-4 grid gap-3 text-sm text-slate-200">
                <div className="flex justify-between gap-4">
                  <dt>Electron</dt>
                  <dd>{runtimeInfo.electron}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Node</dt>
                  <dd>{runtimeInfo.node}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Chrome</dt>
                  <dd>{runtimeInfo.chrome}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Platform</dt>
                  <dd>{runtimeInfo.platform}</dd>
                </div>
              </dl>
            </article>

            <article className="rounded-[24px] border border-white/10 bg-slate-950/40 p-6">
              <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Phase Progress
              </h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li>Phase 0: workspace scaffold, desktop shell, runner process</li>
                <li>Phase 1: shared schemas, playbook metadata, sample runtime</li>
                <li>Phase 2 next: workspace file IO and internal git snapshots</li>
              </ul>
            </article>
          </div>

          <aside className="rounded-[24px] border border-teal-400/20 bg-teal-400/10 p-6">
            <h2 className="text-xs uppercase tracking-[0.3em] text-teal-200">
              Runner Health
            </h2>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-200">
              {runnerHealth ? (
                <div className="space-y-2">
                  <p className="font-medium text-emerald-300">
                    {runnerHealth.service} is {runnerHealth.status}
                  </p>
                  <p>Listening on port {runnerHealth.port}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-amber-300">
                    Runner not detected yet
                  </p>
                  <p>{runnerError || "Start `pnpm dev` to bring up the runner."}</p>
                </div>
              )}
            </div>
          </aside>
        </section>
      </motion.section>
    </main>
  );
}

