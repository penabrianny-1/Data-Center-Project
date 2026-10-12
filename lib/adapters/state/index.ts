import type { Adapter } from "../../ingest/types";
import { adapters as al } from "./al";
import { adapters as ca } from "./ca";
import { adapters as hi } from "./hi";
import { adapters as co } from "./co";
import { adapters as inFinance } from "./in";
import { adapters as ne } from "./ne";
import { adapters as okFinance } from "./ok";
import { adapters as il } from "./il";
import { adapters as inLobby } from "./in-lobby";
import { adapters as ky } from "./ky";
import { adapters as la } from "./la";
import { adapters as ma } from "./ma";
import { adapters as me } from "./me";
import { adapters as mi } from "./mi";
import { adapters as nm } from "./nm";
import { adapters as ny } from "./ny";
import { adapters as oh } from "./oh";
import { adapters as okLobby } from "./ok-lobby";
import { adapters as pa } from "./pa";
import { adapters as wa } from "./wa";
import { adapters as wy } from "./wy";

/** State campaign-finance and lobbying adapters (one module per state; see contract.ts). */
export const STATE_ADAPTERS: Adapter[] = [...al, ...la, ...ma, ...mi, ...nm, ...pa, ...ca, ...co, ...inFinance, ...ne, ...okFinance, ...inLobby, ...ky, ...oh, ...okLobby, ...wy, ...wa, ...ny, ...hi, ...il, ...me];
