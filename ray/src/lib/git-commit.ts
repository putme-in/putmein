/** Match legacy abbreviated IDs against a full remote ID, including failed attempts. */
export function sameGitCommit(remote: string, previous?: string | null): boolean {
  if (!/^[a-f0-9]{40,64}$/i.test(remote) || !previous || !/^[a-f0-9]{7,64}$/i.test(previous)) return false;
  return remote.toLowerCase().startsWith(previous.toLowerCase());
}
