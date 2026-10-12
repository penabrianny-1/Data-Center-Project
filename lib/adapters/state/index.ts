import type { Adapter } from "../../ingest/types";
import { adapters as ca } from "./ca";

/** State campaign-finance and lobbying adapters (one module per state; see contract.ts). */
export const STATE_ADAPTERS: Adapter[] = [...ca];
