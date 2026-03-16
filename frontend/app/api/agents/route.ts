/**
 * app/api/agents/route.ts
 *
 * Lista os 13 agentes AIOX disponíveis.
 */

import { AGENTS } from "@/lib/agents";

export async function GET() {
  const agents = Object.values(AGENTS).map((a) => ({
    name: a.name,
    label: a.label,
    description: a.description,
  }));

  return Response.json({ agents });
}
