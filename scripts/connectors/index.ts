import type { Connector } from "./types";
import { sampleConnector } from "./sample";
import { rssConnector } from "./rss";
import { redditConnector } from "./reddit";

const connectorsByName: Record<string, Connector> = {
  sample: sampleConnector,
  rss: rssConnector,
  reddit: redditConnector,
};

export function getConnector(name: string): Connector | null {
  return connectorsByName[name] ?? null;
}

export function listConnectorNames() {
  return Object.keys(connectorsByName);
}

