// CloudFront Function (viewer-request) for overdub.ajsmithhq.com. The bucket mirrors the repo's served tree
// (site/, app/, docs/), so this maps the public paths onto it the way server/serve.js does locally.
function handler(event) {
  var r = event.request, u = r.uri;
  if (u === '/' || u === '') { r.uri = '/site/index.html'; return r; }
  if (u === '/llms.txt') { r.uri = '/site/llms.txt'; return r; }
  if (u.charAt(u.length - 1) === '/') { r.uri = u + 'index.html'; return r; }
  var last = u.substring(u.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: u + '/' }, 'cache-control': { value: 'max-age=3600' } } };
  }
  return r;
}
