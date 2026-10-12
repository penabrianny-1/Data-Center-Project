import type { Adapter } from "../../ingest/types";
import { adapters as ca } from "./ca";
import { adapters as co } from "./co";
import { adapters as inFinance } from "./in";
import { adapters as ne } from "./ne";
import { adapters as okFinance } from "./ok";
import { adapters as inLobby } from "./in-lobby";
import { adapters as ky } from "./ky";
import { adapters as oh } from "./oh";
import { adapters as okLobby } from "./ok-lobby";
import { adapters as wy } from "./wy";

/** State campaign-finance and lobbying adapters (one module per state; see contract.ts). */
export const STATE_ADAPTERS: Adapter[] = [...ca, ...co, ...inFinance, ...ne, ...okFinance, ...inLobby, ...ky, ...oh, ...okLobby, ...wy];
