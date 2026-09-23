/** Runs once when the server starts. Starts the background jobs unless JOBS_ENABLED=false (e.g. for a one-off script). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOBS_ENABLED !== "false") {
    const { startJobs } = await import("./server/jobs");
    startJobs();
  }
}
