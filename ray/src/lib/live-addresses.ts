export interface LiveAddress { label: string; url: string; note?: string }
export function liveAddresses(primary: string, ips: string[] = []): LiveAddress[] {
  let url: URL;
  try { url = new URL(primary); } catch { return []; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
  const links: LiveAddress[] = [{ label: url.hostname === "localhost" ? "Localhost" : "Application", url: url.href, ...(url.hostname === "localhost" ? { note: "Open on the deployment server itself." } : {}) }];
  // A managed HTTPS origin does not imply an externally published runtime port.
  if (url.protocol !== "http:" || !url.port) return links;
  const port = url.port;
  links.push({ label: "Localhost", url: `http://localhost:${port}/`, note: "Open on the deployment server itself." });
  for (const ip of [...ips, url.hostname]) {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(n => Number(n) > 255) || ip === "0.0.0.0" || ip.startsWith("127.")) continue;
    links.push({ label: "Server IP", url: `http://${ip}:${port}/`, note: "Requires access to this server and port." });
    links.push({ label: "sslip.io", url: `http://${ip.replaceAll('.', '-')}.sslip.io:${port}/`, note: "Uses the same server port; DNS must resolve." });
  }
  return links.filter((link, index) => links.findIndex(other => other.url === link.url) === index);
}
