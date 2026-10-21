import { serverKeyAvailable } from "@/lib/fal-server";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ serverKey: serverKeyAvailable() });
}
