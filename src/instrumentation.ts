import { assertProductionEnvironment } from "@/lib/production-env";

export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.SKIP_RUNTIME_ENV_VALIDATION !== "1"
  ) {
    try {
      assertProductionEnvironment();
    } catch (error) {
      // Next reports instrumentation errors but can leave the HTTP process
      // alive. Exit so an orchestrator never routes traffic to a bad runtime.
      console.error(error instanceof Error ? error.message : "Invalid production environment.");
      process.exit(1);
    }
  }
}
