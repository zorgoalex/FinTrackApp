const SECURITY_POLICY = `Contact: mailto:support@fintrackapp.vip
Expires: 2027-08-21T23:59:59Z
Canonical: https://fintrackapp.vip/.well-known/security.txt
Preferred-Languages: ru, en
Policy: https://fintrackapp.vip/legal
`;

export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.status(200).send(SECURITY_POLICY);
}
