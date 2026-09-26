import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { serviceConfig } from "@/lib/services/config";
import { servePageReport, serviceError } from "@/lib/services/payment";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function POST(request: NextRequest,{params}:{params:Promise<{label:string}>}) {
  try {
    const config=serviceConfig();
    if (!config.ready) return serviceError("service_not_enabled",503);
    return await servePageReport(request,(await params).label,await getDb(),config);
  } catch { return serviceError("service_unavailable",503); }
}
