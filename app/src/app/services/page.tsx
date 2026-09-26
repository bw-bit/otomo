import { ServicesView } from "@/components/ServicesView";
import { getDb } from "@/lib/db";
import { serviceCatalog } from "@/lib/services/config";
export const dynamic="force-dynamic";
export const metadata={title:"Otomo Services — Small jobs for AI agents",description:"Source-linked English and Japanese page reports, paid per request with x402 USDC."};
export default async function ServicesPage(){return <ServicesView catalog={await serviceCatalog(await getDb())}/>;}
