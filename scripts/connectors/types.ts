import type { Mention } from "../../lib/schema";

export type ConnectorContext = {
  start: Date;
  end: Date;
  timeZone: string;
};

export type Connector = {
  name: string;
  getMentions(ctx: ConnectorContext): Promise<Mention[]>;
};

