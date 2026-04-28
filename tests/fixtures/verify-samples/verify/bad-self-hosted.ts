// Regression fixture - verifies the universal (path-based) X-Openbox-Client check
// fires against self-hosted backends on arbitrary domains.
// Tracks: missing-x-openbox-client-header.

async function getProfile(token: string) {
  const res = await fetch('https://openbox.internal.acme.corp/auth/profile', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

async function createAgent(token: string, teamId: string) {
  const res = await fetch('https://our-openbox.example.com/agent', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ agent_name: 'test', team_ids: [teamId] }),
  });
  return res.json();
}
