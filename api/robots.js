export default function handler(_request, response) {
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.status(200).send('User-agent: *\nDisallow: /\n');
}
