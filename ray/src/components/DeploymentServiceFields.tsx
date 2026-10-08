"use client";
import { useId } from "react";
import type { ProjectSetup } from "@/lib/project-setup";

export default function DeploymentServiceFields({value,onChange}:{value:ProjectSetup;onChange:(value:ProjectSetup)=>void}) {
 const id=useId(); const health=value.healthCheck;
 const update=(patch:Partial<ProjectSetup["healthCheck"]>)=>onChange({...value,healthCheck:{...health,...patch}});
 return <div className="flex flex-col gap-4">
  <div><label htmlFor={`${id}-routing`} className="ray-eyebrow block mb-1.5">Access</label>
   <select id={`${id}-routing`} className="ray-input text-xs" value={value.routingMode} onChange={e=>onChange({...value,routingMode:e.target.value as ProjectSetup["routingMode"]})}>
    <option value="port">Direct port</option><option value="https">Domain with managed HTTPS</option>
   </select><p className="text-xs text-white/40 mt-1.5">{value.routingMode==="https" ? "Uses the application URL above. Point its DNS to this server. Caddy must be configured, with ports 80 and 443 reachable. Certificates are issued automatically when domain validation succeeds." : "Connect directly to the application's host port. A saved application URL is only a reference in this mode."}</p>
  </div>
  <div><label htmlFor={`${id}-type`} className="ray-eyebrow block mb-1.5">Startup health check</label><select id={`${id}-type`} className="ray-input text-xs" value={health.type} onChange={e=>update({type:e.target.value as "http"|"tcp"})}><option value="http">HTTP response</option><option value="tcp">TCP connection</option></select></div>
  {health.type==="http"&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label htmlFor={`${id}-path`} className="ray-eyebrow block mb-1.5">Health path</label><input id={`${id}-path`} className="ray-input text-xs font-mono" value={health.path} onChange={e=>update({path:e.target.value})} placeholder="/health" /></div><div><label htmlFor={`${id}-status`} className="ray-eyebrow block mb-1.5">Expected status</label><input id={`${id}-status`} type="number" min={0} max={499} className="ray-input text-xs" value={health.successStatus||""} placeholder="200–399 (default)" onChange={e=>update({successStatus:Number(e.target.value)})}/></div></div>}
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label htmlFor={`${id}-timeout`} className="ray-eyebrow block mb-1.5">Startup timeout (seconds)</label><input id={`${id}-timeout`} type="number" min={5} max={300} className="ray-input text-xs" value={health.timeoutSeconds} onChange={e=>update({timeoutSeconds:Number(e.target.value)})}/></div><div><label htmlFor={`${id}-interval`} className="ray-eyebrow block mb-1.5">Check interval (seconds)</label><input id={`${id}-interval`} type="number" min={1} max={30} className="ray-input text-xs" value={health.intervalSeconds} onChange={e=>update({intervalSeconds:Number(e.target.value)})}/></div></div>
  <p className="text-xs text-white/40">Checks the local application port before completing deployment. HTTP redirects are not followed. TCP confirms a listening service, not application readiness. These settings do not change ongoing Monitor checks.</p>
 </div>;
}
