import { describe, expect, it } from "vitest";
import { COPILOT_TOOLS } from "./copilotTools";
import { COPILOT_LIMITS } from "../../vite-plugins/copilotGuard";

// The gateway guard rejects any Copilot request carrying more tools than COPILOT_LIMITS.maxTools (HTTP 413).
// Adding a tool to COPILOT_TOOLS without raising the cap used to break Copilot for everyone in dev and prod.
describe("Copilot tool cap", () => {
  it("every registered tool fits under the gateway guard's maxTools", () => {
    expect(COPILOT_TOOLS.length).toBeLessThanOrEqual(COPILOT_LIMITS.maxTools);
  });

  it("tool names are unique", () => {
    const names = COPILOT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
